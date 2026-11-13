// База данных Yaeori: SQLite (sql.js, чистый JS/WASM, без сборки под Windows). Файл: data/yaeori.sqlite3.
// Рабочая копия в памяти, на диск пишется атомарно (временный файл + rename) с небольшой задержкой.
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import initSqlJs from "sql.js";

const STOP = new Set("который которая которое которые также можно очень будет есть этого этой этом чтобы когда если после перед через между потому какой какая какие нужно надо вопрос номер привет здравствуйте сообщений сообщение about which would there their these those other where while using should could себя меня тебя тебе мной свой свои своё всего быть были было была только ещё уже или либо чего этим этих того тому тоже здесь сейчас".split(" "));

export async function openDb(root) {
  const file = path.join(root, "data", "yaeori.sqlite3");
  const SQL = await initSqlJs();
  let db;
  try { db = new SQL.Database(existsSync(file) ? readFileSync(file) : undefined); }
  catch {
    // Повреждённый файл не затираем: откладываем в сторону и начинаем с чистой базы.
    try { renameSync(file, file + `.broken-${Date.now()}`); } catch { /* уже нет */ }
    db = new SQL.Database();
  }
  db.run(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, topics TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fact',
      strength REAL NOT NULL DEFAULT 1, chat_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  try { const cols = db.exec("PRAGMA table_info(memories)")[0]?.values.map((r) => r[1]) ?? []; if (!cols.includes("vec")) db.run("ALTER TABLE memories ADD COLUMN vec TEXT"); if (!cols.includes("pinned")) db.run("ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"); if (!cols.includes("state")) db.run("ALTER TABLE memories ADD COLUMN state TEXT"); if (!cols.includes("replaced_by")) db.run("ALTER TABLE memories ADD COLUMN replaced_by INTEGER"); if (!cols.includes("used_at")) db.run("ALTER TABLE memories ADD COLUMN used_at TEXT"); if (!cols.includes("valid_from")) db.run("ALTER TABLE memories ADD COLUMN valid_from TEXT"); if (!cols.includes("valid_to")) db.run("ALTER TABLE memories ADD COLUMN valid_to TEXT"); } catch { /* уже есть */ }
  db.run("CREATE TABLE IF NOT EXISTS chat_summaries (chat_id INTEGER PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, text TEXT NOT NULL, upto INTEGER NOT NULL, updated_at TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS entities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE)");
  db.run("CREATE TABLE IF NOT EXISTS mem_entities (memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY (memory_id, entity_id))");
  db.run("CREATE TABLE IF NOT EXISTS relations (id INTEGER PRIMARY KEY AUTOINCREMENT, subj INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, rel TEXT NOT NULL, obj INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE)");

  let timer = null;
  const flush = () => {
    timer = null;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, Buffer.from(db.export()));
    renameSync(tmp, file);
    db.run("PRAGMA foreign_keys = ON;"); // export() сбрасывает настройки соединения
  };
  const save = () => { if (!timer) timer = setTimeout(flush, 250); };
  const rows = (sql, params = []) => {
    const st = db.prepare(sql); st.bind(params);
    const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out;
  };
  const now = () => new Date().toISOString();
  const norm = (t) => String(t).toLowerCase().replace(/[^a-zа-яё0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const wordsOf = (t) => new Set(norm(t).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));
  const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
  const cleanTopics = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => norm(x).slice(0, 30)).filter((x) => x.length >= 2))].slice(0, 3);
  const memRows = (all = false) => rows(`SELECT m.id, m.text, m.topics, m.kind, m.strength, m.chat_id AS chatId, c.title AS chatTitle, m.created_at AS createdAt, m.updated_at AS at, m.vec AS vecRaw, m.pinned AS pinned, m.state AS state, m.replaced_by AS replacedBy, m.used_at AS usedAt, m.valid_from AS validFrom, m.valid_to AS validTo FROM memories m LEFT JOIN chats c ON c.id = m.chat_id ${all ? "" : "WHERE m.state IS NULL"} ORDER BY m.updated_at DESC`)
    .map(({ vecRaw, pinned, ...m }) => ({ ...m, pinned: Boolean(pinned), topics: String(m.topics).split(",").filter(Boolean), vec: parseVec(m.id, vecRaw) }));
  // ——— Сущности, связи и время действия ———
  const ekey = (n) => norm(n).slice(0, 40);
  const vdate = (x) => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(x ?? "").trim()); return m ? [m[1], m[2], m[3]].filter(Boolean).join("-") : null; };
  const entityId = (name) => {
    const nm = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40), key = ekey(nm); if (key.length < 3) return null;
    const r = rows("SELECT id FROM entities WHERE key = ?", [key])[0]; if (r) return r.id;
    db.run("INSERT INTO entities(name, key) VALUES (?, ?)", [nm, key]); return rows("SELECT last_insert_rowid() AS id")[0].id;
  };
  const SINGULAR = ["живёт", "живет", "работает", "должность", "учится", "переехал"];
  /** Привязывает сущности к воспоминанию и записывает связь «кто — отношение — кто». Для «единственных» отношений (живёт, работает…) прежний факт закрывается датой. */
  const linkEntities = (memId, ents, rel) => {
    const ids = new Set((Array.isArray(ents) ? ents : []).slice(0, 5).map((e) => entityId(typeof e === "string" ? e : e?.name)).filter(Boolean));
    const s = entityId(rel?.s), o = entityId(rel?.o), r = norm(rel?.r ?? "").slice(0, 30);
    if (s && o && r && s !== o) {
      ids.add(s); ids.add(o);
      if (!rows("SELECT 1 AS x FROM relations WHERE subj = ? AND rel = ? AND obj = ?", [s, r, o]).length) {
        if (SINGULAR.some((w) => r.startsWith(w))) for (const old of rows("SELECT memory_id AS mid FROM relations WHERE subj = ? AND rel = ? AND obj != ? AND memory_id IS NOT NULL AND memory_id != ?", [s, r, o, memId])) db.run("UPDATE memories SET valid_to = ? WHERE id = ? AND valid_to IS NULL", [now().slice(0, 10), old.mid]);
        db.run("INSERT INTO relations(subj, rel, obj, memory_id) VALUES (?, ?, ?, ?)", [s, r, o, memId]);
      }
    }
    for (const id of ids) db.run("INSERT OR IGNORE INTO mem_entities(memory_id, entity_id) VALUES (?, ?)", [memId, id]);
  };
  const entMap = () => {
    const keys = rows("SELECT id, key FROM entities"), byMem = new Map(), count = new Map();
    for (const r of rows("SELECT me.memory_id AS mid, me.entity_id AS eid FROM mem_entities me JOIN memories m ON m.id = me.memory_id WHERE m.state IS NULL")) { byMem.set(r.mid, [...(byMem.get(r.mid) ?? []), r.eid]); count.set(r.eid, (count.get(r.eid) ?? 0) + 1); }
    return { keys, byMem, count };
  };
  const vecCache = new Map();
  const parseVec = (id, raw) => { if (!raw) { vecCache.delete(id); return null; } const c = vecCache.get(id); if (c && c.raw === raw) return c.vec; try { const vec = Float32Array.from(JSON.parse(raw)); vecCache.set(id, { raw, vec }); return vec; } catch { return null; } };
  const dot = (a, b) => { if (!a || !b || a.length !== b.length) return 0; let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; };
  let semCache = { key: "", pairs: [] };
  /** Связи по смыслу: до 3 ближайших по вектору соседей из разных тем. Пересчёт только когда меняется набор векторов. */
  const semanticPairs = (mems) => {
    const withVec = mems.filter((m) => m.vec).slice(0, 300), key = withVec.map((m) => m.id).join(",");
    if (semCache.key === key) return semCache.pairs;
    const pairs = new Map();
    for (const m of withVec) {
      const best = []; for (const o of withVec) { if (o.id === m.id || o.grp === m.grp) continue; const sim = dot(m.vec, o.vec); if (sim >= 0.8) best.push([sim, o.id]); }
      best.sort((a, b) => b[0] - a[0]); for (const [, oid] of best.slice(0, 3)) pairs.set(Math.min(m.id, oid) + ":" + Math.max(m.id, oid), { a: Math.min(m.id, oid), b: Math.max(m.id, oid) });
    }
    semCache = { key, pairs: [...pairs.values()] }; return semCache.pairs;
  };

  return {
    file,
    flush: () => { if (timer) { clearTimeout(timer); flush(); } },
    listChats: () => rows("SELECT c.id, c.title, c.created_at AS createdAt, (SELECT count(*) FROM messages m WHERE m.chat_id = c.id) AS count FROM chats c ORDER BY c.id DESC LIMIT 200"),
    createChat: (title = "Новый чат") => { db.run("INSERT INTO chats(title, created_at) VALUES (?, ?)", [title.slice(0, 80), now()]); save(); return rows("SELECT last_insert_rowid() AS id")[0].id; },
    chatExists: (id) => rows("SELECT 1 AS x FROM chats WHERE id = ?", [id]).length > 0,
    renameChat: (id, title) => { db.run("UPDATE chats SET title = ? WHERE id = ?", [title.slice(0, 80), id]); save(); },
    deleteChat: (id) => { db.run("DELETE FROM chats WHERE id = ?", [id]); save(); },
    messages: (chatId) => rows("SELECT id, role, content, created_at AS at FROM messages WHERE chat_id = ? ORDER BY id", [chatId]),
    recent: (chatId, n) => rows("SELECT role, content FROM (SELECT id, role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id", [chatId, n]),
    addMessage: (chatId, role, content) => { db.run("INSERT INTO messages(chat_id, role, content, created_at) VALUES (?, ?, ?, ?)", [chatId, role, content, now()]); save(); return rows("SELECT last_insert_rowid() AS id")[0].id; },
    /**
     * Данные для карты беседы: чаты, последние сообщения (только начало текста) и связи между чатами.
     * Связь — два сообщения из РАЗНЫХ чатов с общими значимыми словами. Считается по тексту при каждом запросе,
     * поэтому отдельно нигде не хранится и всегда соответствует тому, что в базе.
     */
    // ——— Память ———
    /** Сохраняет факты. Повтор (то же или очень похожее) усиливает старую запись, а не плодит новую. boost:false — без усиления (сканирование старых бесед). */
    remember: (facts, chatId = null, { boost = true } = {}) => {
      let added = 0, strengthened = 0; const addedIds = [], strengthenedIds = [];
      const existing = memRows();
      for (const f of Array.isArray(facts) ? facts : []) {
        const text = String(f?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200), topics = cleanTopics(f?.topics);
        if (text.length < 6 || !topics.length) continue;
        const kind = f?.kind === "note" ? "note" : "fact", w = wordsOf(text);
        const same = existing.find((m) => norm(m.text) === norm(text) || (m.topics.some((t) => topics.includes(t)) && jaccard(wordsOf(m.text), w) >= 0.6));
        if (same) {
          const merged = [...new Set([...same.topics, ...topics])].slice(0, 3);
          db.run("UPDATE memories SET strength = ?, topics = ?, updated_at = ? WHERE id = ?", [boost ? Math.min(same.strength + 1, 20) : same.strength, merged.join(","), boost ? now() : same.at, same.id]);
          if (vdate(f?.until)) db.run("UPDATE memories SET valid_to = ? WHERE id = ?", [vdate(f.until), same.id]);
          linkEntities(same.id, f?.entities, f?.rel);
          same.topics = merged; if (boost) { same.strength = Math.min(same.strength + 1, 20); strengthened++; strengthenedIds.push(same.id); }
        } else {
          db.run("INSERT INTO memories(text, topics, kind, strength, chat_id, created_at, updated_at, valid_from, valid_to) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)", [text, topics.join(","), kind, chatId, now(), now(), vdate(f?.from), vdate(f?.until)]);
          const nid = rows("SELECT last_insert_rowid() AS id")[0].id; linkEntities(nid, f?.entities, f?.rel); existing.push({ id: nid, text, topics, kind, strength: 1, at: now() }); added++; addedIds.push(nid);
        }
      }
      if (added || strengthened) save();
      return { added, strengthened, addedIds, strengthenedIds };
    },
    /** Какие воспоминания подсказать модели: совпавшие с текущим сообщением, затем сильные и свежие. */
    recall: (text, n = 12, qvec = null, chatId = null) => {
      const q = norm(text), qw = wordsOf(text), day = 86400000, t = Date.now(), all = memRows(), ent = entMap();
      const qt = q.split(" ").filter(Boolean), hitEnt = new Set(ent.keys.filter((e) => e.key.length >= 3 && e.key.split(" ").every((w) => qt.some((x) => x.startsWith(w.slice(0, Math.max(3, w.length - 2)))))).map((e) => e.id)); // падежи: сравниваем по основе слова
      const entBoost = (m) => (ent.byMem.get(m.id) ?? []).filter((e) => hitEnt.has(e)).reduce((a, e) => a + 4 / (1 + Math.log(ent.count.get(e) ?? 1)), 0);
      const isPast = (m) => Boolean(m.validTo && Date.parse(m.validTo) < t);
      const scored = all.map((m) => {
        const hit = m.topics.filter((x) => q.includes(x)).length * 4 + jaccard(wordsOf(m.text), qw) * 6, sem = qvec && m.vec ? Math.max(0, dot(qvec, m.vec) - 0.25) * 14 : 0;
        return { m, score: hit + sem + entBoost(m) - (isPast(m) ? 2 : 0) + (m.pinned ? 2 : 0) + Math.log(1 + m.strength) + Math.exp(-(t - Date.parse(m.at)) / (60 * day)) };
      }).sort((a, b) => b.score - a.score);
      const seeds = scored.slice(0, Math.max(3, Math.ceil(n * 0.6))).map((x) => x.m), out = seeds.map((m) => ({ ...m, hop: false })), have = new Set(seeds.map((m) => m.id));
      // граф: соседи найденных воспоминаний — по общим темам и по смыслу
      const near = [];
      for (const sd of seeds) for (const m of all) {
        if (have.has(m.id)) continue;
        const se = (ent.byMem.get(m.id) ?? []).filter((e) => (ent.byMem.get(sd.id) ?? []).includes(e)).length, shared = m.topics.filter((x) => sd.topics.includes(x)).length + se, sim = sd.vec && m.vec ? dot(sd.vec, m.vec) : 0;
        if (shared || sim >= 0.78) near.push({ m, w: shared * 2 + sim * 4 + Math.log(1 + m.strength) });
      }
      near.sort((a, b) => b.w - a.w);
      for (const x of near) { if (out.length >= n) break; if (have.has(x.m.id)) continue; have.add(x.m.id); out.push({ ...x.m, hop: true }); }
      // рабочая память беседы: то, что вспомнилось и запомнилось в этом чате за сутки, всегда под рукой
      if (chatId) { const sess = all.filter((m) => m.chatId === chatId && t - Date.parse(m.createdAt) < day).sort((a, b) => b.id - a.id).slice(0, 4), ids = new Set(sess.map((m) => m.id)); out.splice(0, out.length, ...sess.map((m) => ({ ...m, hop: false, session: true })), ...out.filter((m) => !ids.has(m.id))); out.length = Math.min(out.length, Math.max(n, sess.length)); }
      for (const m of out) m.past = isPast(m);
      if (out.length) { const stamp = now(); db.run(`UPDATE memories SET used_at = ? WHERE id IN (${out.map(() => "?").join(",")})`, [stamp, ...out.map((m) => m.id)]); save(); }
      return out.map(({ vec, ...m }) => m);
    },
    /** Забывание по Эббингаузу: эффективная сила = сила × 0.5^(дни без обращения / период). Ниже порога уходит в архив. Закреплённые не трогаем. */
    decay: ({ half = 45, floor = 0.3 } = {}) => {
      const day = 86400000, t = Date.now(); let n = 0;
      for (const m of memRows()) {
        if (m.pinned) continue;
        const last = Math.max(Date.parse(m.at) || 0, m.usedAt ? Date.parse(m.usedAt) || 0 : 0);
        if (m.strength * Math.pow(0.5, (t - last) / day / half) < floor) { db.run("UPDATE memories SET state = 'archived' WHERE id = ?", [m.id]); n++; }
      }
      if (n) save(); return n;
    },
    /** Архив и история: то, что затухло или заменено новым фактом. */
    inactive: () => { const all = memRows(true), byId = new Map(all.map((m) => [m.id, m])); return all.filter((m) => m.state).slice(0, 200).map((m) => ({ id: m.id, text: m.text, state: m.state, topics: m.topics, at: m.at, replacedBy: m.replacedBy ?? null, replacedText: m.replacedBy ? byId.get(m.replacedBy)?.text ?? null : null })); },
    restoreMemory: (id) => { const r = rows("SELECT state FROM memories WHERE id = ?", [id])[0]; if (!r?.state) return null; db.run("UPDATE memories SET state = NULL, replaced_by = NULL, used_at = ?, updated_at = ? WHERE id = ?", [now(), now(), id]); save(); return { ok: true }; },
    /** Скользящее резюме беседы: что уже вышло из окна последних сообщений. */
    getSummary: (chatId) => rows("SELECT text, upto FROM chat_summaries WHERE chat_id = ?", [chatId])[0] ?? null,
    setSummary: (chatId, text, upto) => { db.run("INSERT INTO chat_summaries(chat_id, text, upto, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET text = excluded.text, upto = excluded.upto, updated_at = excluded.updated_at", [chatId, String(text).slice(0, 1200), upto, now()]); save(); },
    messagesAfter: (chatId, afterId, limit = 40) => rows("SELECT id, role, content FROM (SELECT id, role, content FROM messages WHERE chat_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id", [chatId, afterId, limit]),
    messageCount: (chatId) => rows("SELECT count(*) AS n FROM messages WHERE chat_id = ?", [chatId])[0].n,
    /** Старые похожие воспоминания одной темы (≥4) — кандидаты на сжатие в одно обобщённое. */
    compressClusters: () => {
      const day = 86400000, t = Date.now(), by = new Map();
      for (const m of memRows()) { if (m.pinned) continue; const last = Math.max(Date.parse(m.at) || 0, m.usedAt ? Date.parse(m.usedAt) || 0 : 0); if ((t - last) / day < 21) continue; const k = m.topics[0]; by.set(k, [...(by.get(k) ?? []), m]); }
      return [...by].filter(([, g]) => g.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([topic, g]) => ({ topic, items: g.slice(0, 8).map((m) => ({ id: m.id, text: m.text })) }));
    },
    /** Сжатие: создаётся одно обобщённое воспоминание, исходные уходят в историю со ссылкой на него. */
    compressMemories: (ids, text, topic) => {
      const src = memRows().filter((m) => ids.includes(m.id) && !m.pinned); text = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (src.length < 2 || text.length < 6) return null;
      const topics = cleanTopics([topic, ...src.flatMap((m) => m.topics)]), strength = Math.min(20, Math.max(...src.map((m) => m.strength)) + 1);
      db.run("INSERT INTO memories(text, topics, kind, strength, chat_id, created_at, updated_at, used_at) VALUES (?, ?, 'fact', ?, NULL, ?, ?, ?)", [text, topics.join(","), strength, now(), now(), now()]);
      const nid = rows("SELECT last_insert_rowid() AS id")[0].id;
      for (const m of src) db.run("UPDATE memories SET state = 'replaced', replaced_by = ? WHERE id = ?", [nid, m.id]);
      save(); return { ok: true, id: nid, replaced: src.length };
    },
    /** Сущности: люди, места, организации, техника — с их связями и воспоминаниями. */
    entityList: () => {
      const mems = new Map(memRows().map((m) => [m.id, m])), rel = rows("SELECT s.name AS s, r.rel AS r, o.name AS o, r.memory_id AS mid, r.subj AS subj, r.obj AS obj FROM relations r JOIN entities s ON s.id = r.subj JOIN entities o ON o.id = r.obj");
      return rows("SELECT e.id, e.name, (SELECT group_concat(memory_id) FROM mem_entities x WHERE x.entity_id = e.id) AS mids FROM entities e").map((e) => {
        const ids = String(e.mids ?? "").split(",").filter(Boolean).map(Number).filter((i) => mems.has(i));
        return { id: e.id, name: e.name, memories: ids, relations: rel.filter((r) => (r.subj === e.id || r.obj === e.id) && (r.mid == null || mems.has(r.mid))).map((r) => ({ s: r.s, r: r.r, o: r.o, past: Boolean(mems.get(r.mid)?.validTo) })) };
      }).filter((e) => e.memories.length).sort((a, b) => b.memories.length - a.memories.length).slice(0, 100);
    },
    /** Векторы воспоминаний: ещё не посчитанные, запись и сводка. */
    missingVecs: (limit = 32) => rows("SELECT id, text FROM memories WHERE vec IS NULL OR vec = '' ORDER BY id DESC LIMIT ?", [limit]),
    memoriesByIds: (ids) => memRows().filter((m) => ids.includes(m.id)).map((m) => ({ id: m.id, text: m.text })),
    setVecs: (pairs) => { for (const [id, v] of pairs) db.run("UPDATE memories SET vec = ? WHERE id = ?", [JSON.stringify(Array.from(v, (x) => Math.round(x * 1e4) / 1e4)), id]); if (pairs.length) save(); },
    vecStats: () => { const r = rows("SELECT count(*) AS total, sum(CASE WHEN vec IS NOT NULL AND vec != '' THEN 1 ELSE 0 END) AS indexed FROM memories")[0]; return { total: r.total, indexed: r.indexed ?? 0 }; },
    listMemories: (topic = "") => memRows().filter((m) => !topic || m.topics.includes(norm(topic))).slice(0, 300),
    /** Правка воспоминания: текст, темы, закрепление. После смены текста вектор пересчитается сам. */
    updateMemory: (id, patch) => {
      const cur = memRows().find((m) => m.id === id); if (!cur) return null;
      const text = patch.text === undefined ? cur.text : String(patch.text).replace(/\s+/g, " ").trim().slice(0, 200);
      const topics = patch.topics === undefined ? cur.topics : cleanTopics(patch.topics);
      if (text.length < 3 || !topics.length) return { error: "Нужен текст и хотя бы одна тема" };
      const pinned = patch.pinned === undefined ? cur.pinned : Boolean(patch.pinned);
      db.run("UPDATE memories SET text = ?, topics = ?, pinned = ?, strength = ?, updated_at = ? WHERE id = ?", [text, topics.join(","), pinned ? 1 : 0, pinned ? Math.max(cur.strength, 3) : cur.strength, now(), id]);
      if (text !== cur.text) db.run("UPDATE memories SET vec = NULL WHERE id = ?", [id]);
      save(); return { ok: true };
    },
    /** Полная копия: беседы, сообщения, память. Векторы не входят: они досчитаются сами. Ключ Cloud.ru не входит. */
    exportAll: () => ({
      app: "yaeori", version: 1, exportedAt: now(),
      chats: rows("SELECT id, title, created_at AS createdAt FROM chats ORDER BY id"),
      messages: rows("SELECT id, chat_id AS chatId, role, content, created_at AS createdAt FROM messages ORDER BY id"),
      memories: memRows(true).map(({ vec, chatTitle, ...m }) => m).sort((a, b) => a.id - b.id).map((m) => ({ ...m, entities: rows("SELECT e.name FROM mem_entities x JOIN entities e ON e.id = x.entity_id WHERE x.memory_id = ?", [m.id]).map((r) => r.name), rels: rows("SELECT s.name AS s, r.rel AS r, o.name AS o FROM relations r JOIN entities s ON s.id = r.subj JOIN entities o ON o.id = r.obj WHERE r.memory_id = ?", [m.id]) })),
    }),
    /** Заменяет всё содержимое данными из копии. Всё или ничего: при ошибке остаётся прежнее. */
    importAll: (d) => {
      const isArr = (x) => Array.isArray(x) && x.length <= 200000, S = (v, n) => String(v ?? "").slice(0, n);
      if (!d || d.app !== "yaeori" || !isArr(d.chats) || !isArr(d.messages) || !isArr(d.memories)) return { error: "Это не копия Yaeori" };
      const ids = new Set(d.chats.map((c) => Number(c?.id)));
      try {
        db.run("BEGIN");
        db.run("DELETE FROM memories"); db.run("DELETE FROM entities"); db.run("DELETE FROM messages"); db.run("DELETE FROM chats");
        for (const c of d.chats) db.run("INSERT INTO chats(id, title, created_at) VALUES (?, ?, ?)", [Number(c.id), S(c.title, 80) || "Чат", S(c.createdAt, 40) || now()]);
        let nm = 0; for (const m of d.messages) { if (!ids.has(Number(m?.chatId)) || (m.role !== "user" && m.role !== "assistant")) continue; db.run("INSERT INTO messages(id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)", [Number(m.id), Number(m.chatId), m.role, S(m.content, 200000), S(m.createdAt, 40) || now()]); nm++; }
        let nmem = 0; for (const m of d.memories) { const text = S(m?.text, 200).trim(), topics = cleanTopics(Array.isArray(m?.topics) ? m.topics : String(m?.topics ?? "").split(",")); if (text.length < 3 || !topics.length) continue; db.run("INSERT INTO memories(id, text, topics, kind, strength, chat_id, created_at, updated_at, pinned, state, replaced_by, used_at, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [Number(m.id), text, topics.join(","), m.kind === "note" ? "note" : "fact", Math.min(20, Math.max(1, Number(m.strength) || 1)), ids.has(Number(m.chatId)) ? Number(m.chatId) : null, S(m.createdAt, 40) || now(), S(m.updatedAt ?? m.at, 40) || now(), m.pinned ? 1 : 0, m.state === "archived" || m.state === "replaced" ? m.state : null, Number.isInteger(m.replacedBy) ? m.replacedBy : null, S(m.usedAt, 40) || null, vdate(m.validFrom), vdate(m.validTo)]); if (Array.isArray(m.entities) || Array.isArray(m.rels)) { linkEntities(Number(m.id), m.entities, null); for (const r of (Array.isArray(m.rels) ? m.rels : []).slice(0, 5)) linkEntities(Number(m.id), [], r); } nmem++; }
        db.run("COMMIT"); save(); vecCache.clear(); semCache = { key: "", pairs: [] };
        return { ok: true, chats: d.chats.length, messages: nm, memories: nmem };
      } catch (e) { try { db.run("ROLLBACK"); } catch { /* уже откачено */ } return { error: "Копию не удалось загрузить: " + (e?.message ?? "ошибка") }; }
    },
    /** Кандидаты в дубли: близкие по смыслу (вектор) или по словам при общей теме. Группы по 2–6 воспоминаний. */
    duplicateGroups: () => {
      const all = memRows(), par = new Map(all.map((m) => [m.id, m.id])), find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
      const ws = new Map(all.map((m) => [m.id, wordsOf(m.text)]));
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j], sim = a.vec && b.vec ? dot(a.vec, b.vec) : 0, share = a.topics.some((t) => b.topics.includes(t));
        if (sim >= 0.92 || (share && jaccard(ws.get(a.id), ws.get(b.id)) >= 0.5)) par.set(find(a.id), find(b.id));
      }
      const groups = new Map(); for (const m of all) { const r = find(m.id); groups.set(r, [...(groups.get(r) ?? []), m]); }
      return [...groups.values()].filter((g) => g.length >= 2 && g.length <= 6).slice(0, 30).map((g) => {
        const keep = [...g].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.strength - x.strength || y.text.length - x.text.length)[0];
        return { keep: keep.id, items: g.map((m) => ({ id: m.id, text: m.text, hits: m.strength, pinned: m.pinned })) };
      });
    },
    memoryTexts: (limit = 60) => memRows().slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.strength - a.strength).slice(0, limit).map((m) => ({ id: m.id, text: m.text })),
    /** Слияние: остаётся keep, у него сила и темы всех, остальные удаляются. */
    mergeMemories: (keepId, dropIds, history = false) => {
      const all = memRows(), keep = all.find((m) => m.id === keepId), drops = all.filter((m) => dropIds.includes(m.id) && m.id !== keepId); if (!keep || !drops.length) return null;
      const topics = [...new Set([...keep.topics, ...drops.flatMap((m) => m.topics)])].slice(0, 3), strength = Math.min(20, keep.strength + drops.reduce((s, m) => s + m.strength, 0)), pinned = keep.pinned || drops.some((m) => m.pinned);
      if (history) { db.run("UPDATE memories SET updated_at = ?, used_at = ? WHERE id = ?", [now(), now(), keepId]); for (const m of drops) db.run("UPDATE memories SET state = 'replaced', replaced_by = ? WHERE id = ?", [keepId, m.id]); }
      else { db.run("UPDATE memories SET topics = ?, strength = ?, pinned = ?, updated_at = ? WHERE id = ?", [topics.join(","), strength, pinned ? 1 : 0, now(), keepId]); for (const m of drops) db.run("DELETE FROM memories WHERE id = ?", [m.id]); }
      save(); return { ok: true, merged: drops.length };
    },
    deleteMemory: (id) => { db.run("DELETE FROM memories WHERE id = ?", [id]); save(); },
    clearMemories: () => { db.run("DELETE FROM memories"); save(); },
    countMemories: () => rows("SELECT count(*) AS n FROM memories WHERE state IS NULL")[0].n,
    /** Последние реплики из всех чатов для сканирования старых бесед. */
    transcript: (limit = 60) => rows("SELECT chat_id AS chatId, role, content FROM (SELECT id, chat_id, role, content FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id", [limit]),
    /**
     * Мозг: темы — узлы-центры, факты — точки вокруг своей темы. Связь — два факта из РАЗНЫХ тем, у которых есть общая тема.
     * Рост: size и сила факта растут с повторами; «strong» у тех, что подтверждались несколько раз.
     */
    memGraph: () => {
      const all = memRows().slice(0, 400), weight = new Map();
      for (const m of all) m.topics.forEach((t, i) => weight.set(t, (weight.get(t) ?? 0) + m.strength * (i === 0 ? 1 : 0.4)));
      const top = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t), id = new Map(top.map((t, i) => [t, i + 1]));
      const mems = []; 
      for (const m of all) { const g = m.topics.find((t) => id.has(t)); if (g) mems.push({ ...m, grp: id.get(g) }); }
      const chats = top.map((t) => ({ id: id.get(t), title: t, count: mems.filter((m) => m.grp === id.get(t)).length })).filter((c) => c.count > 0);
      const day = 86400000, t = Date.now(), tierOf = (m) => { const age = (t - Date.parse(m.at)) / day; return m.pinned || m.strength >= 3 ? "long" : age <= 3 ? "fresh" : age > 14 ? "fading" : "plain"; };
      const messages = mems.map((m) => ({ id: m.id, chatId: m.grp, role: m.kind === "fact" ? "user" : "assistant", preview: m.text, size: Math.round(40 * m.strength), at: m.createdAt, upd: m.at, tier: tierOf(m), pinned: m.pinned, hits: m.strength, src: m.chatId ?? 0, topics: m.topics, past: Boolean(m.validTo && Date.parse(m.validTo) < t) }));
      const byTopic = new Map(); for (const m of mems) for (const t of m.topics) byTopic.set(t, [...(byTopic.get(t) ?? []), m]);
      const pairs = new Map();
      for (const [t, ms] of byTopic) { if (ms.length < 2 || ms.length > 14) continue;
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j]; if (a.grp === b.grp) continue;
          const k = Math.min(a.id, b.id) + ":" + Math.max(a.id, b.id), p = pairs.get(k) ?? { a: a.id, b: b.id, w: 0, words: [], kinds: [] }; p.w++; if (p.words.length < 3) p.words.push(t); if (!p.kinds.includes("topic")) p.kinds.push("topic"); pairs.set(k, p); } }
      for (const p of semanticPairs(mems)) { const k = Math.min(p.a, p.b) + ":" + Math.max(p.a, p.b), cur = pairs.get(k); if (cur) { cur.w += 1; if (cur.words.length < 3) cur.words.push("по смыслу"); if (!cur.kinds.includes("sense")) cur.kinds.push("sense"); } else pairs.set(k, { a: p.a, b: p.b, w: 1.2, words: ["по смыслу"], kinds: ["sense"] }); }
      // общая сущность: воспоминания об одном человеке, месте или технике
      const em = entMap(), byEnt = new Map(), nameOf = new Map(rows("SELECT id, name FROM entities").map((r) => [r.id, r.name]));
      for (const m of mems) for (const e of em.byMem.get(m.id) ?? []) byEnt.set(e, [...(byEnt.get(e) ?? []), m]);
      for (const [e, ms] of byEnt) { if (ms.length < 2 || ms.length > 8) continue;
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j], k = Math.min(a.id, b.id) + ":" + Math.max(a.id, b.id), p = pairs.get(k) ?? { a: a.id, b: b.id, w: 0, words: [], kinds: [] }; p.w += 1.5; if (p.words.length < 3) p.words.push("@" + nameOf.get(e)); if (!p.kinds.includes("entity")) p.kinds.push("entity"); pairs.set(k, p); } }
      // из одной беседы: цепочка воспоминаний, рождённых в одном чате, если они в разных темах
      const byChat = new Map(); for (const m of mems) if (m.chatId) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
      for (const ms of byChat.values()) { ms.sort((x, y) => x.id - y.id); for (let i = 1; i < ms.length; i++) { const a = ms[i - 1], b = ms[i]; if (a.grp === b.grp) continue; const k = Math.min(a.id, b.id) + ":" + Math.max(a.id, b.id), cur = pairs.get(k); if (cur) { if (!cur.kinds.includes("chat")) cur.kinds.push("chat"); } else pairs.set(k, { a: a.id, b: b.id, w: 0.8, words: ["из одной беседы"], kinds: ["chat"] }); } }
      const links = [...pairs.values()].sort((x, y) => y.w - x.w).slice(0, 160), total = all.length, STAGES = [[0, "Зародыш"], [5, "Росток"], [20, "Ученик"], [60, "Знаток"], [150, "Мудрец"]];
      let lv = 0; STAGES.forEach(([n], i) => { if (total >= n) lv = i; });
      return { mode: "memory", chats, messages, links, stats: { memories: total, topics: chats.length, links: links.length, level: lv + 1, levelName: STAGES[lv][1], next: STAGES[lv + 1]?.[0] ?? null } };
    },
    graph: () => {
      const chats = rows("SELECT c.id, c.title, (SELECT count(*) FROM messages m WHERE m.chat_id = c.id) AS count FROM chats c ORDER BY c.id DESC LIMIT 12");
      const full = rows("SELECT id, chat_id AS chatId, role, content, created_at AS at FROM messages WHERE chat_id IN (SELECT id FROM chats ORDER BY id DESC LIMIT 12) ORDER BY id DESC LIMIT 400").reverse();
      const messages = full.map((m) => ({ id: m.id, chatId: m.chatId, role: m.role, preview: String(m.content).slice(0, 160), size: String(m.content).length, at: m.at }));
      const index = new Map();
      for (const m of full) {
        const words = new Set((String(m.content).toLowerCase().match(/[a-zа-яё]{5,}/g) ?? []).filter((w) => !STOP.has(w)));
        for (const w of words) { const a = index.get(w) ?? []; a.push(m); index.set(w, a); }
      }
      const pairs = new Map();
      for (const [w, ms] of index) {
        if (ms.length < 2 || ms.length > 8) continue; // слишком общие слова связей не дают
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
          const a = ms[i], b = ms[j]; if (a.chatId === b.chatId) continue;
          const k = a.id + ":" + b.id, p = pairs.get(k) ?? { a: a.id, b: b.id, w: 0, words: [] };
          p.w++; if (p.words.length < 3) p.words.push(w); pairs.set(k, p);
        }
      }
      const links = [...pairs.values()].sort((x, y) => y.w - x.w).slice(0, 120);
      return { chats, messages, links };
    },
  };
}
