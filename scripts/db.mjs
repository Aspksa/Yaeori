// База данных Yaeori: SQLite (sql.js, чистый JS/WASM, без сборки под Windows). Файл: data/yaeori.sqlite3.
// Рабочая копия в памяти, на диск пишется атомарно (временный файл + rename) с небольшой задержкой.
import path from "node:path";
import { openStore } from "./sqlstore.mjs";

const STOP = new Set("который которая которое которые также можно очень будет есть этого этой этом чтобы когда если после перед через между потому какой какая какие нужно надо вопрос номер привет здравствуйте сообщений сообщение about which would there their these those other where while using should could себя меня тебя тебе мной свой свои своё всего быть были было была только ещё уже или либо чего этим этих того тому тоже здесь сейчас".split(" "));

export async function openDb(root) {
  const file = path.join(root, "data", "yaeori.sqlite3");
  const store = await openStore(file), db = { run: store.run };
  db.run(`CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, topics TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fact',
      strength REAL NOT NULL DEFAULT 1, chat_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  try { const cols = store.cols("memories"); if (!cols.includes("vec")) db.run("ALTER TABLE memories ADD COLUMN vec TEXT"); if (!cols.includes("pinned")) db.run("ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"); if (!cols.includes("state")) db.run("ALTER TABLE memories ADD COLUMN state TEXT"); if (!cols.includes("replaced_by")) db.run("ALTER TABLE memories ADD COLUMN replaced_by INTEGER"); if (!cols.includes("used_at")) db.run("ALTER TABLE memories ADD COLUMN used_at TEXT"); if (!cols.includes("valid_from")) db.run("ALTER TABLE memories ADD COLUMN valid_from TEXT"); if (!cols.includes("valid_to")) db.run("ALTER TABLE memories ADD COLUMN valid_to TEXT"); } catch { /* уже есть */ }
  try { const cols = store.cols("memories"); for (const [c, t] of [["learned_at", "TEXT"], ["src", "TEXT"], ["importance", "REAL"], ["mtype", "TEXT"]]) if (!cols.includes(c)) db.run(`ALTER TABLE memories ADD COLUMN ${c} ${t}`); db.run("UPDATE memories SET learned_at = created_at WHERE learned_at IS NULL"); } catch { /* уже есть */ }
  try { const cols = store.cols("memories"); for (const [c, t] of [["ev_against", "INTEGER NOT NULL DEFAULT 0"], ["src_msg", "INTEGER"], ["src_quote", "TEXT"], ["proof", "TEXT"], ["due_at", "TEXT"]]) if (!cols.includes(c)) db.run(`ALTER TABLE memories ADD COLUMN ${c} ${t}`); } catch { /* уже есть */ }
  db.run("CREATE TABLE IF NOT EXISTS causal (cause INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, effect INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, PRIMARY KEY (cause, effect))");
  db.run("CREATE TABLE IF NOT EXISTS vectors (memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE, data BLOB NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS chat_summaries (chat_id INTEGER PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, text TEXT NOT NULL, upto INTEGER NOT NULL, updated_at TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS topic_summaries (topic TEXT PRIMARY KEY, text TEXT NOT NULL, n INTEGER NOT NULL, updated_at TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS link_weights (a INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, b INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, w REAL NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (a, b))");
  // Полнотекстовый поиск (FTS5) есть у node:sqlite; у запасного sql.js его нет, тогда работает прежний подсчёт по словам.
  let hasFts = false;
  if (store.kind === "node:sqlite") try {
    const fresh = !rows("SELECT 1 AS x FROM sqlite_master WHERE name = 'mem_fts'").length;
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(text, topics, content='memories', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS mem_fts_ai AFTER INSERT ON memories BEGIN INSERT INTO mem_fts(rowid, text, topics) VALUES (new.id, new.text, new.topics); END;
      CREATE TRIGGER IF NOT EXISTS mem_fts_ad AFTER DELETE ON memories BEGIN INSERT INTO mem_fts(mem_fts, rowid, text, topics) VALUES ('delete', old.id, old.text, old.topics); END;
      CREATE TRIGGER IF NOT EXISTS mem_fts_au AFTER UPDATE OF text, topics ON memories BEGIN INSERT INTO mem_fts(mem_fts, rowid, text, topics) VALUES ('delete', old.id, old.text, old.topics); INSERT INTO mem_fts(rowid, text, topics) VALUES (new.id, new.text, new.topics); END;`);
    if (fresh) db.run("INSERT INTO mem_fts(mem_fts) VALUES ('rebuild')");
    hasFts = true;
  } catch { hasFts = false; }
  db.run("CREATE TABLE IF NOT EXISTS disputes (a INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, b INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, PRIMARY KEY (a, b))");
  db.run("CREATE TABLE IF NOT EXISTS entities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE)");
  db.run("CREATE TABLE IF NOT EXISTS mem_entities (memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY (memory_id, entity_id))");
  db.run("CREATE TABLE IF NOT EXISTS relations (id INTEGER PRIMARY KEY AUTOINCREMENT, subj INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, rel TEXT NOT NULL, obj INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE)");

  const rows = store.all;
  let cache = null; // активные воспоминания в памяти: пересобираются только после записи
  const save = (keepCache = false) => { if (!keepCache) cache = null; store.save(); };
  const now = () => new Date().toISOString();
  const norm = (t) => String(t).toLowerCase().replace(/[^a-zа-яё0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const wordsOf = (t) => new Set(norm(t).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));
  const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
  const cleanTopics = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => norm(x).slice(0, 30)).filter((x) => x.length >= 2))].slice(0, 3);
  // ——— Векторы: int8 в BLOB (1 КБ вместо 8 КБ JSON), в памяти тоже int8 со своим масштабом .s ———
  const vecs = new Map(); let vecsLoaded = false;
  const quant = (v) => {
    let n = 0, mx = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) mx = Math.max(mx, Math.abs(v[i]) / n);
    const s = mx / 127 || 1, q = new Int8Array(v.length); for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / n / s);
    q.s = s; return q;
  };
  const packVec = (q) => { const b = new Uint8Array(4 + q.length); new DataView(b.buffer).setFloat32(0, q.s, true); b.set(new Uint8Array(q.buffer, q.byteOffset, q.length), 4); return b; };
  const unpackVec = (b) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b), q = new Int8Array(u.length - 4); q.set(new Int8Array(u.buffer, u.byteOffset + 4, q.length)); q.s = new DataView(u.buffer, u.byteOffset, 4).getFloat32(0, true); return q; };
  const loadVecs = () => {
    if (vecsLoaded) return; vecsLoaded = true;
    // миграция со старого формата (JSON в memories.vec)
    const old = rows("SELECT id, vec FROM memories WHERE vec IS NOT NULL AND vec != ''");
    if (old.length) { db.run("BEGIN"); for (const r of old) { try { const q = quant(JSON.parse(r.vec)); db.run("INSERT OR REPLACE INTO vectors(memory_id, data) VALUES (?, ?)", [r.id, packVec(q)]); } catch { /* битый вектор пересчитается */ } } db.run("UPDATE memories SET vec = NULL"); db.run("COMMIT"); store.save(); }
    for (const r of rows("SELECT memory_id AS id, data FROM vectors")) vecs.set(r.id, unpackVec(r.data));
  };
  const memRows = (all = false) => {
    if (!all && cache) return cache.rows;
    loadVecs();
    const out = rows(`SELECT m.id, m.text, m.topics, m.kind, m.strength, m.chat_id AS chatId, c.title AS chatTitle, m.created_at AS createdAt, m.updated_at AS at, m.pinned AS pinned, m.state AS state, m.replaced_by AS replacedBy, m.used_at AS usedAt, m.valid_from AS validFrom, m.valid_to AS validTo, m.learned_at AS learnedAt, m.src AS src, m.importance AS importance, m.mtype AS mtype, m.ev_against AS against, m.src_msg AS srcMsg, m.src_quote AS quote, m.proof AS proof, m.due_at AS dueAt FROM memories m LEFT JOIN chats c ON c.id = m.chat_id ${all ? "" : "WHERE m.state IS NULL"} ORDER BY m.updated_at DESC`)
      .map(({ pinned, ...m }) => ({ ...m, conf: confOf(m), pinned: Boolean(pinned), topics: String(m.topics).split(",").filter(Boolean), vec: vecs.get(m.id) ?? null }));
    if (!all) cache = { rows: out, byId: new Map(out.map((m) => [m.id, m])), idx: null, dd: null };
    return out;
  };
  const ekey = (n) => norm(n).slice(0, 40);
  const vdate = (x) => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(x ?? "").trim()); return m ? [m[1], m[2], m[3]].filter(Boolean).join("-") : null; };
  const entityId = (name) => {
    const nm = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40), key = ekey(nm); if (key.length < 3) return null;
    const r = rows("SELECT id FROM entities WHERE key = ?", [key])[0]; if (r) return r.id;
    const tk = key.split(" "); // «Иван П.» и «Иван Петров» — один человек
    if (tk.length === 2) {
      if (tk[1].length === 1) { const c = rows("SELECT id, key FROM entities WHERE key LIKE ?", [tk[0] + " " + tk[1] + "%"]).filter((e) => e.key.split(" ").length === 2); if (c.length === 1) return c[0].id; }
      else { const c = rows("SELECT id FROM entities WHERE key = ?", [tk[0] + " " + tk[1][0]])[0]; if (c) { db.run("UPDATE entities SET name = ?, key = ? WHERE id = ?", [nm, key, c.id]); return c.id; } }
    }
    db.run("INSERT INTO entities(name, key) VALUES (?, ?)", [nm, key]); return rows("SELECT last_insert_rowid() AS id")[0].id;
  };
  const confOf = (m) => (Math.min(20, m.strength ?? 1) + 1) / (Math.min(20, m.strength ?? 1) + (m.against ?? 0) * 1.5 + 2); // достоверность: подтверждения против возражений
  const DOW = { понедельник: 1, вторник: 2, среду: 3, среда: 3, четверг: 4, пятницу: 5, пятница: 5, субботу: 6, суббота: 6, воскресенье: 0 };
  const ymd = (d) => d.toISOString().slice(0, 10);
  /** Срок из текста: «до 15.11», «до пятницы», «завтра». Возвращает ГГГГ-ММ-ДД или null. */
  const parseDue = (text) => {
    const t = norm(text), base = new Date(); base.setUTCHours(12, 0, 0, 0);
    let m = /до (\d{1,2}) (\d{1,2})(?: (\d{2,4}))?(?:\s|$)/.exec(t) || /до (\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/.exec(String(text).toLowerCase());
    if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : base.getUTCFullYear(); let d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), 12)); if (!m[3] && d < base) d = new Date(Date.UTC(y + 1, Number(m[2]) - 1, Number(m[1]), 12)); if (!Number.isNaN(d.getTime())) return ymd(d); }
    m = /до (понедельник|вторник|сред[уа]|четверг|пятниц[уа]|суббот[уы]|воскресенье)/.exec(t); if (m) { const key = Object.keys(DOW).find((k) => m[1].startsWith(k.slice(0, 5))); const want = DOW[key]; const d = new Date(base); d.setUTCDate(d.getUTCDate() + ((want - d.getUTCDay() + 7) % 7 || 7)); return ymd(d); }
    if (/(^| )послезавтра( |$)/.test(t)) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + 2); return ymd(d); }
    if (/(^| )завтра( |$)/.test(t)) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + 1); return ymd(d); }
    return null;
  };
  const vdue = (x) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x ?? "").trim()); return m && !Number.isNaN(Date.parse(x)) ? m[0] : null; };
  /** Закрыли причину: следствия теряют часть достоверности (до двух шагов вглубь). */
  const cascadeDoubt = (id, depth = 0, seen = new Set()) => {
    let n = 0; if (depth > 1 || seen.has(id)) return 0; seen.add(id);
    for (const r of rows("SELECT effect FROM causal WHERE cause = ?", [id])) { db.run("UPDATE memories SET ev_against = ev_against + 1 WHERE id = ?", [r.effect]); n += 1 + cascadeDoubt(r.effect, depth + 1, seen); }
    return n;
  };
  const pre = (w) => w.slice(0, 3);
  /** Мягкое сходство по основам слов («курю» ≈ «курить»). */
  const soft = (a, b) => { if (!a.size || !b.size) return 0; const pb = new Set([...b].map(pre)); let k = 0; for (const w of a) if (pb.has(pre(w))) k++; return k / Math.max(a.size, b.size); };
  const MTYPES = new Set(["fact", "preference", "event", "rule"]);
  const HL = { preference: 2.5, rule: 4, event: 0.3 }; // срок «забывания» зависит от типа: события быстро, правила долго
  const impOf = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 1 ? Math.min(10, Math.round(n)) : null; };
  const unconfirmed = (m) => (m.src === "reflect" || m.src === "tool"); // вывод модели или запись «по инструменту», пока человек не подтвердил
  const INJECT = /(игнорируй|забудь|отмени)\s+(все\s+|предыдущ|прежн|свои|системн)|ignore\s+(all\s+|any\s+)?(previous|prior|above)|system\s*prompt|системн\w+\s+(промпт|инструкц)|ты\s+теперь\s+(не\s+)?(ассистент|помощница|бот)|reveal\s+your/i;
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
    memRows(); if (cache.ent) return cache.ent;
    const keys = rows("SELECT id, key FROM entities"), byMem = new Map(), count = new Map(), byEnt = new Map(), rel = new Map();
    for (const r of rows("SELECT me.memory_id AS mid, me.entity_id AS eid FROM mem_entities me JOIN memories m ON m.id = me.memory_id WHERE m.state IS NULL")) { byMem.set(r.mid, [...(byMem.get(r.mid) ?? []), r.eid]); count.set(r.eid, (count.get(r.eid) ?? 0) + 1); const l = byEnt.get(r.eid) ?? []; if (l.length < 60) l.push(r.mid); byEnt.set(r.eid, l); }
    for (const r of rows("SELECT r.subj AS a, r.obj AS b FROM relations r LEFT JOIN memories m ON m.id = r.memory_id WHERE r.memory_id IS NULL OR m.state IS NULL")) { if (!rel.has(r.a)) rel.set(r.a, new Set()); if (!rel.has(r.b)) rel.set(r.b, new Set()); rel.get(r.a).add(r.b); rel.get(r.b).add(r.a); }
    return (cache.ent = { keys, byMem, count, byEnt, rel });
  };
  const dot = (a, b) => { if (!a || !b || a.length !== b.length) return 0; let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t * (a.s ?? 1) * (b.s ?? 1); };
  // ——— Быстрые индексы: слова (без перебора всех пар), темы с центрами (поиск по ближайшим темам), LSH для векторов ———
  const wmeta = new Map(); // id -> { text, n, w }: нормализованный текст и слова считаем один раз
  const meta = (m) => { let c = wmeta.get(m.id); if (!c || c.text !== m.text) { c = { text: m.text, n: norm(m.text), w: wordsOf(m.text) }; wmeta.set(m.id, c); } return c; };
  const wordIdx = () => {
    memRows(); if (cache.idx) return cache.idx;
    const idx = { byWord: new Map(), byNorm: new Map(), pos: new Map() };
    cache.rows.forEach((m, i) => addIdx(idx, m, i)); return (cache.idx = idx);
  };
  const addIdx = (idx, m, pos) => { const c = meta(m); idx.pos.set(m.id, pos); if (!idx.byNorm.has(c.n)) idx.byNorm.set(c.n, m); for (const w of c.w) { const l = idx.byWord.get(w); if (l) l.push(m); else idx.byWord.set(w, [m]); } };
  /** Кандидаты с jaccard ≥ thr по словам. Префиксный фильтр: достаточно проверить самые редкие k − ⌈thr·k⌉ + 1 слов, результат тот же, что при полном переборе. */
  const wordCandidates = (idx, w, thr) => {
    const k = w.size; if (!k) return [];
    const probe = [...w].sort((a, b) => (idx.byWord.get(a)?.length ?? 0) - (idx.byWord.get(b)?.length ?? 0)).slice(0, k - Math.ceil(thr * k) + 1), seen = new Map();
    for (const x of probe) for (const m of idx.byWord.get(x) ?? []) seen.set(m.id, m);
    return [...seen.values()];
  };
  /** Кандидаты, у которых есть общее (не слишком частое) слово. Для поиска противоречий, где слов общих мало. */
  const sharedCandidates = (idx, w) => { const seen = new Map(); for (const x of w) { const l = idx.byWord.get(x); if (l && l.length <= 300) for (const m of l) seen.set(m.id, m); } return [...seen.values()]; };
  const topicIdx = () => {
    memRows(); if (cache.tp) return cache.tp;
    const tp = new Map(), sums = new Map();
    for (const m of cache.rows) for (const t of m.topics) { const g = tp.get(t) ?? tp.set(t, { rows: [], cen: null }).get(t); g.rows.push(m); }
    for (const m of cache.rows) { if (!m.vec) continue; const t = m.topics[0]; let c = sums.get(t); if (!c) sums.set(t, (c = new Float32Array(m.vec.length))); if (c.length !== m.vec.length) continue; const sc = m.vec.s; for (let i = 0; i < c.length; i++) c[i] += m.vec[i] * sc; }
    for (const [t, c] of sums) { let n = 0; for (let i = 0; i < c.length; i++) n += c[i] * c[i]; n = Math.sqrt(n) || 1; for (let i = 0; i < c.length; i++) c[i] /= n; tp.get(t).cen = c; }
    return (cache.tp = tp);
  };
  const PART = 2500; // с этого размера памяти ищем не по всей, а по ближайшим темам
  const shortlist = (all, qvec, q, ent, hitEnt, chatId, t) => {
    const tp = topicIdx(), pick = new Map();
    const near = [...tp].filter(([, g]) => g.cen).map(([name, g]) => [q.includes(name) ? 9 : dot(qvec, g.cen), name]).sort((a, b) => b[0] - a[0]).slice(0, 5);
    for (const [, name] of near) for (const m of tp.get(name).rows) pick.set(m.id, m);
    for (const name of tp.keys()) if (q.includes(name)) for (const m of tp.get(name).rows) pick.set(m.id, m);
    for (const m of all.slice(0, 80)) pick.set(m.id, m); // самые свежие
    for (const m of all) if (m.pinned || (chatId && m.chatId === chatId && t - Date.parse(m.createdAt) < 86400000) || (ent.byMem.get(m.id) ?? []).some((e) => hitEnt.has(e))) pick.set(m.id, m);
    return [...pick.values()];
  };
  /** Пары с cos ≥ thr. До 600 векторов — точный перебор; больше — LSH (случайные гиперплоскости, корзины), в корзинах точная проверка. */
  const lshPairs = (items, thr) => {
    const out = [], v = items.filter((m) => m.vec);
    if (v.length <= 600) { for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (dot(v[i].vec, v[j].vec) >= thr) out.push([v[i], v[j]]); return out; }
    const dim = v[0].vec.length, BITS = 10, TABLES = 14, SUB = Math.min(dim, 128); let budget = 4e6, seed = 12345;
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296 - 0.5; };
    const planes = Array.from({ length: TABLES * BITS }, () => ({ at: Int32Array.from({ length: SUB }, () => Math.floor((rnd() + 0.5) * dim)), sg: Float32Array.from({ length: SUB }, () => (rnd() > 0 ? 1 : -1)) })), seen = new Set();
    for (let tb = 0; tb < TABLES; tb++) {
      const buckets = new Map();
      for (const m of v) { if (m.vec.length !== dim) continue; let sig = 0; for (let b = 0; b < BITS; b++) { const pl = planes[tb * BITS + b]; let d = 0; for (let i = 0; i < SUB; i++) d += pl.sg[i] * m.vec[pl.at[i]]; if (d > 0) sig |= 1 << b; } const l = buckets.get(sig); if (l) l.push(m); else buckets.set(sig, [m]); }
      for (const l of buckets.values()) { const cap = Math.min(l.length, 80); for (let i = 0; i < cap && budget > 0; i++) for (let j = i + 1; j < l.length && j < i + 40; j++) { budget--; const a = l[i], b = l[j], k = a.id < b.id ? a.id * 4194304 + b.id : b.id * 4194304 + a.id; if (seen.has(k)) continue; seen.add(k); if (dot(a.vec, b.vec) >= thr) out.push([a, b]); } }
    }
    return out;
  };
  /** Слова вопроса → ранги в FTS5 (bm25). Падежи: ищем по основе слова. */
  const ftsRanks = (qw, limit = 40) => {
    if (!hasFts || !qw.size) return new Map();
    const terms = [...qw].slice(0, 12).map((w) => `"${w.slice(0, Math.max(3, w.length - 2)).replace(/"/g, "")}"*`).join(" OR ");
    try { return new Map(rows("SELECT rowid AS id FROM mem_fts WHERE mem_fts MATCH ? ORDER BY bm25(mem_fts) LIMIT ?", [terms, limit]).map((r, i) => [r.id, 1 - i / limit])); } catch { return new Map(); }
  };
  /** Привычные связи: что часто вспоминается вместе, связано крепче (правило Хебба). */
  const lwKey = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
  const linkW = () => { memRows(); if (!cache.lw) { cache.lw = new Map(); for (const r of rows("SELECT a, b, w FROM link_weights")) cache.lw.set(lwKey(r.a, r.b), r.w); } return cache.lw; };
  const fire = (ids) => {
    const lw = linkW(), stamp = now(), list = ids.slice(0, 6);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = Math.min(list[i], list[j]), b = Math.max(list[i], list[j]), w = Math.min(20, (lw.get(lwKey(a, b)) ?? 0) + 1);
      db.run("INSERT INTO link_weights(a, b, w, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET w = excluded.w, updated_at = excluded.updated_at", [a, b, w, stamp]); lw.set(lwKey(a, b), w);
    }
  };
  // ——— Настройки поиска, битовые отпечатки, споры, правила противоречий ———
  const loadW = () => { try { return { vec: 1, lex: 1, imp: 1, ...JSON.parse(rows("SELECT value FROM meta WHERE key = 'weights'")[0]?.value ?? "{}") }; } catch { return { vec: 1, lex: 1, imp: 1 }; } };
  let W = loadW();
  const POP = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const sigOf = (v) => { const w = new Uint32Array(Math.ceil(v.length / 32)); for (let i = 0; i < v.length; i++) if (v[i] > 0) w[i >>> 5] |= 1 << (i & 31); return w; };
  const sigCache = new Map();
  const sigFor = (m) => { const c = sigCache.get(m.id); if (c && c.v === m.vec) return c.s; const s = sigOf(m.vec); sigCache.set(m.id, { v: m.vec, s }); return s; };
  const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += POP(a[i] ^ b[i]); return d; };
  /** Сходство вопроса с воспоминаниями. На большой памяти сначала дешёвый битовый отбор (расстояние Хэмминга), точный косинус только для лучших. */
  const vecSims = (all, qvec) => {
    const out = new Map(); if (!qvec) return out;
    const withV = all.filter((m) => m.vec && m.vec.length === qvec.length);
    if (withV.length <= 1500) { for (const m of withV) out.set(m.id, dot(qvec, m.vec)); return out; }
    const qs = sigOf(qvec), bits = qvec.length, ranked = withV.map((m) => [hamming(qs, sigFor(m)), m]).sort((a, b) => a[0] - b[0]);
    ranked.forEach(([h, m], i) => out.set(m.id, i < 400 ? dot(qvec, m.vec) : Math.cos(Math.PI * h / bits)));
    return out;
  };
  /** MMR: набираем не просто самые подходящие, а разные. Почти одинаковое теряет баллы. */
  const mmrPick = (scored, k) => {
    const pool = scored.slice(0, Math.max(k * 4, 12)), pick = [];
    const sim = (a, b) => (a.vec && b.vec ? dot(a.vec, b.vec) : jaccard(meta(a).w, meta(b).w));
    while (pick.length < k && pool.length) {
      let bi = 0, bs = -1e9;
      for (let i = 0; i < pool.length; i++) { let mx = 0; for (const p of pick) mx = Math.max(mx, sim(pool[i].m, p.m)); const v = pool[i].score - 4 * Math.max(0, mx - 0.7) / 0.3; if (v > bs) { bs = v; bi = i; } }
      pick.push(pool.splice(bi, 1)[0]);
    }
    return pick;
  };
  // Споры: факты, которые не могут быть верны оба. Не затираем, а помечаем и спрашиваем.
  const NEGW = new Set(["никогда", "перестал", "перестала", "перестали", "бросил", "бросила", "бросили"]);
  const hasNeg = (t) => /(^|\s)(не|нет|никогда|перестал[аи]?|бросил[аи]?)(\s|$)/.test(norm(t));
  const EXCL = [/(?:живёт|живет|проживает|переехал[аи]?)\s+(?:в|во|на)\s+([a-zа-яё0-9-]+)/, /работает\s+(?:в|во|на|по|как)\s+([a-zа-яё0-9-]+)/, /(?:учится|учился|учусь)\s+(?:в|во|на)\s+([a-zа-яё0-9-]+)/, /(?:ездит|ездила)\s+на\s+([a-zа-яё0-9-]+)/];
  const PASTW = /(раньше|прежде|когда-то|в прошлом|ранее|до этого)/;
  /** Правила без модели: «любит» против «не любит» и разные значения одного и того же («живёт в…», «работает в…»). */
  const conflictReason = (ta, tb) => {
    const a = norm(ta), b = norm(tb); if (PASTW.test(a) || PASTW.test(b)) return null;
    for (const re of EXCL) { const x = re.exec(a), y = re.exec(b); if (x && y && x[1].slice(0, 4) !== y[1].slice(0, 4)) return `разные значения: «${x[1]}» и «${y[1]}»`; }
    if (hasNeg(a) !== hasNeg(b)) { const wa = [...wordsOf(a)].filter((w) => !NEGW.has(w)), wb = [...wordsOf(b)].filter((w) => !NEGW.has(w)); if (jaccard(new Set(wa), new Set(wb)) >= 0.5) return "одно говорит «да», другое «нет»"; }
    return null;
  };
  const addDispute = (x, y, reason) => { const a = Math.min(x, y), b = Math.max(x, y); db.run("INSERT OR IGNORE INTO disputes(a, b, reason, state, created_at) VALUES (?, ?, ?, 'open', ?)", [a, b, reason, now()]); if (cache) cache.dp = null; };
  const disputeSet = () => { memRows(); if (!cache.dp) { cache.dp = new Set(); for (const r of rows("SELECT a, b FROM disputes WHERE state = 'open'")) { cache.dp.add(r.a); cache.dp.add(r.b); } } return cache.dp; };
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

  const dupGroups = (strict) => {
      const all = memRows(), par = new Map(all.map((m) => [m.id, m.id])), find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
      const join = (a, b) => { const why = conflictReason(a.text, b.text); if (why) { addDispute(a.id, b.id, why); return; } par.set(find(a.id), find(b.id)); }, idx = wordIdx(); // «любит» и «не любит» не дубли, а спор
      for (const a of all) for (const b of wordCandidates(idx, meta(a).w, strict ? 0.8 : 0.5)) { if (b.id <= a.id) continue; if (a.topics.some((t) => b.topics.includes(t)) && jaccard(meta(a).w, meta(b).w) >= (strict ? 0.8 : 0.5)) join(a, b); }
      for (const [a, b] of lshPairs(all, strict ? 0.97 : 0.92)) join(a, b);
      const groups = new Map(); for (const m of all) { const r = find(m.id); groups.set(r, [...(groups.get(r) ?? []), m]); }
      return [...groups.values()].filter((g) => g.length >= 2 && g.length <= 6).slice(0, 30).map((g) => {
        const keep = [...g].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.strength - x.strength || y.text.length - x.text.length)[0];
        return { keep: keep.id, items: g.map((m) => ({ id: m.id, text: m.text, hits: m.strength, pinned: m.pinned })) };
      });
    };
  const mergeNow = (keepId, dropIds, history = false) => {
      const all = memRows(), keep = all.find((m) => m.id === keepId), drops = all.filter((m) => dropIds.includes(m.id) && m.id !== keepId); if (!keep || !drops.length) return null;
      const topics = [...new Set([...keep.topics, ...drops.flatMap((m) => m.topics)])].slice(0, 3), strength = Math.min(20, keep.strength + drops.reduce((s, m) => s + m.strength, 0)), pinned = keep.pinned || drops.some((m) => m.pinned);
      if (history) { db.run("UPDATE memories SET updated_at = ?, used_at = ? WHERE id = ?", [now(), now(), keepId]); for (const m of drops) db.run("UPDATE memories SET state = 'replaced', replaced_by = ? WHERE id = ?", [keepId, m.id]); }
      else { db.run("UPDATE memories SET topics = ?, strength = ?, pinned = ?, updated_at = ?, src = ? WHERE id = ?", [topics.join(","), strength, pinned ? 1 : 0, now(), unconfirmed(keep) && drops.some((m) => !unconfirmed(m)) ? "chat" : keep.src ?? null, keepId]); for (const m of drops) { db.run("DELETE FROM memories WHERE id = ?", [m.id]); vecs.delete(m.id); } }
      save(); return { ok: true, merged: drops.length };
    };

  const api = {
    file,
    flush: () => store.flush(),
    ...(process.env.YAEORI_TEST ? { testRun: (sql, p) => { db.run(sql, p); cache = null; store.save(); } } : {}), // только для тестов
    engine: store.kind,
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
    remember: (facts, chatId = null, { boost = true, src = "chat", msgId = null, quote = null } = {}) => {
      let added = 0, strengthened = 0, skipped = 0, blocked = 0; const addedIds = [], strengthenedIds = [], ids = [];
      const existing = memRows().slice(), idx = wordIdx();
      for (const [fi, f] of (Array.isArray(facts) ? facts : []).entries()) {
        if (Number.isInteger(f?.skip)) { ids[fi] = f.skip; continue; }
        const text = String(f?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200), topics = cleanTopics(f?.topics);
        if (text.length < 6 || !topics.length) continue;
        if (wordsOf(text).size < 2) { skipped++; continue; } // фильтр новизны: пустые реплики не запоминаем
        if (INJECT.test(text)) { blocked++; continue; } // «память» не принимает команды: попытку подсунуть инструкцию не записываем
        const mtype = MTYPES.has(f?.mtype) ? f.mtype : null, due = vdue(f?.due) ?? (src === "chat" ? parseDue(text) : null), imp = due ? Math.max(8, impOf(f?.importance) ?? 0) : impOf(f?.importance);
        const kind = f?.kind === "note" ? "note" : "fact", w = wordsOf(text);
        const same = idx.byNorm.get(norm(text)) ?? wordCandidates(idx, w, 0.6).filter((m) => m.topics.some((t) => topics.includes(t)) && jaccard(meta(m).w, w) >= 0.6 && !conflictReason(text, m.text)).sort((a, b) => idx.pos.get(a.id) - idx.pos.get(b.id))[0];
        if (same) {
          const merged = [...new Set([...same.topics, ...topics])].slice(0, 3);
          db.run("UPDATE memories SET strength = ?, topics = ?, updated_at = ?, importance = COALESCE(?, importance), mtype = COALESCE(mtype, ?) WHERE id = ?", [boost ? Math.min(same.strength + 1, 20) : same.strength, merged.join(","), boost ? now() : same.at, imp, mtype, same.id]);
          if (src === "chat" && unconfirmed(same)) { db.run("UPDATE memories SET src = 'chat' WHERE id = ?", [same.id]); same.src = "chat"; } // человек сказал то же сам: запись подтверждена
          if (vdate(f?.until)) db.run("UPDATE memories SET valid_to = ? WHERE id = ?", [vdate(f.until), same.id]);
          linkEntities(same.id, f?.entities, f?.rel); ids[fi] = same.id; if (due) db.run("UPDATE memories SET due_at = ?, importance = MAX(COALESCE(importance, 0), 8) WHERE id = ?", [due, same.id]);
          same.topics = merged; if (boost) { same.strength = Math.min(same.strength + 1, 20); strengthened++; strengthenedIds.push(same.id); }
        } else {
          db.run("INSERT INTO memories(text, topics, kind, strength, chat_id, created_at, updated_at, valid_from, valid_to, learned_at, src, importance, mtype, src_msg, src_quote, due_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [text, topics.join(","), kind, chatId, now(), now(), vdate(f?.from), vdate(f?.until), now(), src, imp, mtype, msgId, quote ? String(quote).slice(0, 240) : null, due]);
          const nid = rows("SELECT last_insert_rowid() AS id")[0].id; ids[fi] = nid; { const b = Number.isInteger(f?.because) ? ids[f.because] : null; if (b && b !== nid) db.run("INSERT OR IGNORE INTO causal(cause, effect) VALUES (?, ?)", [b, nid]); } linkEntities(nid, f?.entities, f?.rel); const nr = { id: nid, text, topics, kind, strength: 1, at: now(), src, mtype, importance: imp }; for (const o of sharedCandidates(idx, w)) { if (o.id === nid || !o.topics.some((t) => topics.includes(t))) continue; const why = conflictReason(text, o.text); if (why) { if (why.startsWith("разные") && /(теперь|сейчас|уже|переех)/.test(norm(text))) db.run("UPDATE memories SET valid_to = ? WHERE id = ? AND valid_to IS NULL", [now().slice(0, 10), o.id]); else addDispute(nid, o.id, why); } } existing.push(nr); addIdx(idx, nr, existing.length); added++; addedIds.push(nid);
        }
      }
      if (added || strengthened) save();
      return { added, strengthened, skipped, blocked, addedIds, strengthenedIds, ids };
    },
    /** Какие воспоминания подсказать модели: совпавшие с текущим сообщением, затем сильные и свежие. */
    recall: (text, n = 12, qvec = null, chatId = null, { dry = false } = {}) => {
      const q = norm(text), qw = wordsOf(text), day = 86400000, t = Date.now(), all0 = memRows(), ent = entMap();
      const qt = q.split(" ").filter(Boolean), hitEnt = new Set(ent.keys.filter((e) => e.key.length >= 3 && e.key.split(" ").every((w) => qt.some((x) => x.startsWith(w.slice(0, Math.max(3, w.length - 2)))))).map((e) => e.id)); // падежи: сравниваем по основе слова
      const fts = ftsRanks(qw), lw = linkW(), all1 = qvec && all0.length > PART ? shortlist(all0, qvec, q, ent, hitEnt, chatId, t) : all0, all = fts.size && all1 !== all0 ? [...new Map([...all1, ...all0.filter((m) => fts.has(m.id))].map((m) => [m.id, m])).values()] : all1;
      const entBoost = (m) => (ent.byMem.get(m.id) ?? []).filter((e) => hitEnt.has(e)).reduce((a, e) => a + 4 / (1 + Math.log(ent.count.get(e) ?? 1)), 0);
      const isPast = (m) => Boolean(m.validTo && Date.parse(m.validTo) < t);
      const sims = vecSims(all, qvec), dp = disputeSet();
      const scored = all.map((m) => {
        const lex = m.topics.filter((x) => q.includes(x)).length * 4 + jaccard(meta(m).w, qw) * 6 + (fts.get(m.id) ?? 0) * 3, sem = Math.max(0, (sims.get(m.id) ?? 0) - 0.25) * 14;
        const imp = (m.pinned ? 2 : 0) + Math.log(1 + m.strength) + (m.importance ? m.importance / 10 - 0.5 : 0) + Math.exp(-(t - Date.parse(m.at)) / (60 * day));
        return { m, score: W.lex * lex + W.vec * sem + W.imp * imp + entBoost(m) - (isPast(m) ? 2 : 0) - (unconfirmed(m) ? 1.2 : 0) + (m.conf - 0.6) * 2 };
      }).sort((a, b) => b.score - a.score);
      const seeds = mmrPick(scored, Math.max(3, Math.ceil(n * 0.6))).map((x) => x.m), out = seeds.map((m) => ({ ...m, hop: false })), have = new Set(seeds.map((m) => m.id));
      // граф: соседи найденных воспоминаний — по общим темам и по смыслу
      const near = [];
      for (const sd of (all.length < all0.length ? seeds.slice(0, 4) : seeds)) for (const m of all) {
        if (have.has(m.id)) continue;
        const se = (ent.byMem.get(m.id) ?? []).filter((e) => (ent.byMem.get(sd.id) ?? []).includes(e)).length, shared = m.topics.filter((x) => sd.topics.includes(x)).length + se, sim = sd.vec && m.vec ? dot(sd.vec, m.vec) : 0;
        const hab = lw.get(lwKey(sd.id, m.id)) ?? 0;
        if (shared || sim >= 0.78 || hab) near.push({ m, w: shared * 2 + sim * 4 + Math.min(hab, 8) * 0.8 + Math.log(1 + m.strength) });
      }
      // растекание активации по графу сущностей: найденное будит соседей через общих людей, места, технику и связи между ними (2 шага)
      const act = new Map(); let front = new Map(seeds.map((m) => [m.id, 1]));
      for (let hop = 0; hop < 2 && front.size; hop++) {
        const next = new Map(), put = (mid, a) => { if (a > (next.get(mid) ?? 0)) next.set(mid, a); };
        for (const [mid, a] of front) for (const e of ent.byMem.get(mid) ?? []) {
          const wE = a * 0.55 / (1 + Math.log(ent.count.get(e) ?? 1));
          for (const m2 of ent.byEnt.get(e) ?? []) if (m2 !== mid) put(m2, wE);
          for (const e2 of ent.rel.get(e) ?? []) for (const m2 of ent.byEnt.get(e2) ?? []) if (m2 !== mid) put(m2, wE * 0.7);
        }
        for (const [mid, a] of next) if (a > (act.get(mid) ?? 0)) act.set(mid, a);
        front = next;
      }
      for (const [mid, a] of act) { if (have.has(mid) || a < 0.05) continue; const m = cache.byId.get(mid); if (m) near.push({ m, w: a * 30 + Math.log(1 + m.strength), g: true }); }
      { const sid = seeds.map((m) => m.id).filter(Number.isInteger); if (sid.length) for (const r of rows(`SELECT cause, effect FROM causal WHERE cause IN (${sid.join(",")}) OR effect IN (${sid.join(",")})`)) for (const mid of [r.cause, r.effect]) { if (have.has(mid)) continue; const m = cache.byId.get(mid); if (m) near.push({ m, w: 14 + Math.log(1 + m.strength), g: true }); } } // причины и следствия подтягиваются вместе
      near.sort((a, b) => b.w - a.w);
      for (const x of near) { if (out.length >= n) break; if (have.has(x.m.id)) continue; have.add(x.m.id); out.push({ ...x.m, hop: true, graph: Boolean(x.g) }); }
      // рабочая память беседы: то, что вспомнилось и запомнилось в этом чате за сутки, всегда под рукой
      if (chatId) { const sess = all.filter((m) => m.chatId === chatId && t - Date.parse(m.createdAt) < day).sort((a, b) => b.id - a.id).slice(0, 4), ids = new Set(sess.map((m) => m.id)); out.splice(0, out.length, ...sess.map((m) => ({ ...m, hop: false, session: true })), ...out.filter((m) => !ids.has(m.id))); out.length = Math.min(out.length, Math.max(n, sess.length)); }
      for (const m of out) { m.past = isPast(m); m.disputed = dp.has(m.id); m.hyp = unconfirmed(m); }
      if (out.length && !dry) { const stamp = now(); db.run(`UPDATE memories SET used_at = ? WHERE id IN (${out.map(() => "?").join(",")})`, [stamp, ...out.map((m) => m.id)]); for (const m of out) { const c = cache?.byId.get(m.id); if (c) c.usedAt = stamp; } fire(out.filter((m) => !m.session).map((m) => m.id)); save(true); }
      return out.map(({ vec, ...m }) => m);
    },
    /** Забывание по Эббингаузу: эффективная сила = сила × 0.5^(дни без обращения / период). Ниже порога уходит в архив. Закреплённые не трогаем. */
    decay: ({ half = 45, floor = 0.3 } = {}) => {
      const day = 86400000, t = Date.now(); let n = 0;
      for (const m of memRows()) {
        if (m.pinned) continue;
        const last = Math.max(Date.parse(m.at) || 0, m.usedAt ? Date.parse(m.usedAt) || 0 : 0);
        const hl = half * (HL[m.mtype] ?? 1) * (unconfirmed(m) ? 0.4 : 1), impF = m.importance ? 0.6 + m.importance / 10 : 1; // неподтверждённые выводы забываются быстрее
        if (m.strength * impF * Math.pow(0.5, (t - last) / day / hl) < floor) { db.run("UPDATE memories SET state = 'archived' WHERE id = ?", [m.id]); n++; }
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
      for (const m of memRows()) { if (m.pinned || unconfirmed(m)) continue; const last = Math.max(Date.parse(m.at) || 0, m.usedAt ? Date.parse(m.usedAt) || 0 : 0); if ((t - last) / day < 21) continue; const k = m.topics[0]; by.set(k, [...(by.get(k) ?? []), m]); }
      return [...by].filter(([, g]) => g.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([topic, g]) => ({ topic, items: g.slice(0, 8).map((m) => ({ id: m.id, text: m.text })) }));
    },
    /** Сжатие: создаётся одно обобщённое воспоминание, исходные уходят в историю со ссылкой на него. */
    compressMemories: (ids, text, topic) => {
      const src = memRows().filter((m) => ids.includes(m.id) && !m.pinned); text = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (src.length < 2 || text.length < 6) return null;
      const topics = cleanTopics([topic, ...src.flatMap((m) => m.topics)]), strength = Math.min(20, Math.max(...src.map((m) => m.strength)) + 1);
      db.run("INSERT INTO memories(text, topics, kind, strength, chat_id, created_at, updated_at, used_at, learned_at, src) VALUES (?, ?, 'fact', ?, NULL, ?, ?, ?, ?, 'sleep')", [text, topics.join(","), strength, now(), now(), now(), now()]);
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
    missingVecs: (limit = 32) => rows("SELECT m.id, m.text FROM memories m LEFT JOIN vectors v ON v.memory_id = m.id WHERE v.memory_id IS NULL ORDER BY m.id DESC LIMIT ?", [limit]),
    memoriesByIds: (ids) => memRows().filter((m) => ids.includes(m.id)).map((m) => ({ id: m.id, text: m.text })),
    setVecs: (pairs) => { loadVecs(); for (const [id, v] of pairs) { const q = quant(v); db.run("INSERT OR REPLACE INTO vectors(memory_id, data) VALUES (?, ?)", [id, packVec(q)]); vecs.set(id, q); } if (pairs.length) save(); },
    vecStats: () => ({ total: rows("SELECT count(*) AS n FROM memories")[0].n, indexed: rows("SELECT count(*) AS n FROM vectors")[0].n }),
    listMemories: (topic = "") => memRows().filter((m) => !topic || m.topics.includes(norm(topic))).slice(0, 300),
    /** Правка воспоминания: текст, темы, закрепление. После смены текста вектор пересчитается сам. */
    updateMemory: (id, patch) => {
      const cur = memRows().find((m) => m.id === id); if (!cur) return null;
      const text = patch.text === undefined ? cur.text : String(patch.text).replace(/\s+/g, " ").trim().slice(0, 200);
      const topics = patch.topics === undefined ? cur.topics : cleanTopics(patch.topics);
      if (text.length < 3 || !topics.length) return { error: "Нужен текст и хотя бы одна тема" };
      const pinned = patch.pinned === undefined ? cur.pinned : Boolean(patch.pinned);
      db.run("UPDATE memories SET text = ?, topics = ?, pinned = ?, strength = ?, updated_at = ? WHERE id = ?", [text, topics.join(","), pinned ? 1 : 0, pinned ? Math.max(cur.strength, 3) : cur.strength, now(), id]);
      if (text !== cur.text) { db.run("DELETE FROM vectors WHERE memory_id = ?", [id]); vecs.delete(id); }
      save(); return { ok: true };
    },
    /** Полная копия: беседы, сообщения, память. Векторы не входят: они досчитаются сами. Ключ Cloud.ru не входит. */
    exportAll: () => ({
      app: "yaeori", version: 1, exportedAt: now(),
      chats: rows("SELECT id, title, created_at AS createdAt FROM chats ORDER BY id"),
      messages: rows("SELECT id, chat_id AS chatId, role, content, created_at AS createdAt FROM messages ORDER BY id"),
      causal: rows("SELECT cause, effect FROM causal"),
      memories: memRows(true).map(({ vec, chatTitle, ...m }) => m).sort((a, b) => a.id - b.id).map((m) => ({ ...m, entities: rows("SELECT e.name FROM mem_entities x JOIN entities e ON e.id = x.entity_id WHERE x.memory_id = ?", [m.id]).map((r) => r.name), rels: rows("SELECT s.name AS s, r.rel AS r, o.name AS o FROM relations r JOIN entities s ON s.id = r.subj JOIN entities o ON o.id = r.obj WHERE r.memory_id = ?", [m.id]) })),
    }),
    /** Заменяет всё содержимое данными из копии. Всё или ничего: при ошибке остаётся прежнее. */
    importAll: (d) => {
      const isArr = (x) => Array.isArray(x) && x.length <= 200000, S = (v, n) => String(v ?? "").slice(0, n);
      if (!d || d.app !== "yaeori" || !isArr(d.chats) || !isArr(d.messages) || !isArr(d.memories)) return { error: "Это не копия Yaeori" };
      const ids = new Set(d.chats.map((c) => Number(c?.id)));
      try {
        db.run("BEGIN");
        db.run("DELETE FROM memories"); db.run("DELETE FROM topic_summaries"); db.run("DELETE FROM entities"); db.run("DELETE FROM messages"); db.run("DELETE FROM chats");
        for (const c of d.chats) db.run("INSERT INTO chats(id, title, created_at) VALUES (?, ?, ?)", [Number(c.id), S(c.title, 80) || "Чат", S(c.createdAt, 40) || now()]);
        let nm = 0; for (const m of d.messages) { if (!ids.has(Number(m?.chatId)) || (m.role !== "user" && m.role !== "assistant")) continue; db.run("INSERT INTO messages(id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)", [Number(m.id), Number(m.chatId), m.role, S(m.content, 200000), S(m.createdAt, 40) || now()]); nm++; }
        let nmem = 0; for (const m of d.memories) { const text = S(m?.text, 200).trim(), topics = cleanTopics(Array.isArray(m?.topics) ? m.topics : String(m?.topics ?? "").split(",")); if (text.length < 3 || !topics.length) continue; db.run("INSERT INTO memories(id, text, topics, kind, strength, chat_id, created_at, updated_at, pinned, state, replaced_by, used_at, valid_from, valid_to, learned_at, src, importance, mtype, ev_against, src_msg, src_quote, proof, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [Number(m.id), text, topics.join(","), m.kind === "note" ? "note" : "fact", Math.min(20, Math.max(1, Number(m.strength) || 1)), ids.has(Number(m.chatId)) ? Number(m.chatId) : null, S(m.createdAt, 40) || now(), S(m.updatedAt ?? m.at, 40) || now(), m.pinned ? 1 : 0, m.state === "archived" || m.state === "replaced" ? m.state : null, Number.isInteger(m.replacedBy) ? m.replacedBy : null, S(m.usedAt, 40) || null, vdate(m.validFrom), vdate(m.validTo), S(m.learnedAt, 40) || S(m.createdAt, 40) || now(), ["user", "reflect", "tool", "sleep", "chat"].includes(m.src) ? m.src : null, impOf(m.importance), MTYPES.has(m.mtype) ? m.mtype : null, Math.max(0, Math.min(50, Number(m.against) || 0)), Number.isInteger(m.srcMsg) ? m.srcMsg : null, m.quote ? S(m.quote, 240) : null, m.proof ? S(m.proof, 200) : null, vdue(m.dueAt)]); if (Array.isArray(m.entities) || Array.isArray(m.rels)) { linkEntities(Number(m.id), m.entities, null); for (const r of (Array.isArray(m.rels) ? m.rels : []).slice(0, 5)) linkEntities(Number(m.id), [], r); } nmem++; }
        for (const c of (isArr(d.causal) ? d.causal : [])) { if (Number.isInteger(c?.cause) && Number.isInteger(c?.effect)) db.run("INSERT OR IGNORE INTO causal(cause, effect) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM memories WHERE id = ?) AND EXISTS (SELECT 1 FROM memories WHERE id = ?)", [c.cause, c.effect, c.cause, c.effect]); }
        db.run("COMMIT"); save(); vecs.clear(); vecsLoaded = false; semCache = { key: "", pairs: [] };
        return { ok: true, chats: d.chats.length, messages: nm, memories: nmem };
      } catch (e) { try { db.run("ROLLBACK"); } catch { /* уже откачено */ } return { error: "Копию не удалось загрузить: " + (e?.message ?? "ошибка") }; }
    },
    /** Кандидаты в дубли: близкие по смыслу (вектор) или по словам при общей теме. Группы по 2–6 воспоминаний. */
    duplicateGroups: () => dupGroups(false),
    memoryTexts: (limit = 60) => memRows().slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.strength - a.strength).slice(0, limit).map((m) => ({ id: m.id, text: m.text })),
    /** Слияние: остаётся keep, у него сила и темы всех, остальные удаляются. */
    mergeMemories: mergeNow,
    deleteMemory: (id) => { db.run("DELETE FROM memories WHERE id = ?", [id]); vecs.delete(id); save(); },
    clearMemories: () => { db.run("DELETE FROM memories"); db.run("DELETE FROM topic_summaries"); vecs.clear(); save(); },
    /** Темы по весу (для подсказки модели при записи): дёшево, без построения карты. */
    topicNames: (n = 24) => { const w = new Map(); for (const m of memRows()) m.topics.forEach((t, i) => w.set(t, (w.get(t) ?? 0) + m.strength * (i === 0 ? 1 : 0.4))); return [...w].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t); },
    /** Сводки по темам: тема считается по первой теме воспоминания. Нужна новая, если воспоминаний стало заметно больше или тема ещё без сводки. */
    topicsToSummarize: ({ min = 8, delta = 5, limit = 3 } = {}) => {
      const by = new Map(); for (const m of memRows()) { const t = m.topics[0]; by.set(t, [...(by.get(t) ?? []), m]); }
      const have = new Map(rows("SELECT topic, n FROM topic_summaries").map((r) => [r.topic, r.n]));
      return [...by].filter(([t, ms]) => ms.length >= min && (!have.has(t) || ms.length - have.get(t) >= delta)).sort((a, b) => b[1].length - a[1].length).slice(0, limit)
        .map(([topic, ms]) => ({ topic, n: ms.length, texts: ms.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.strength - a.strength).slice(0, 40).map((m) => m.text) }));
    },
    setTopicSummary: (topic, text, n) => { db.run("INSERT INTO topic_summaries(topic, text, n, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(topic) DO UPDATE SET text = excluded.text, n = excluded.n, updated_at = excluded.updated_at", [topic, String(text).slice(0, 400), n, now()]); store.save(); },
    /** Крупнейшие темы со сводками: всегда в контексте модели, чтобы она знала общую картину, даже если вспомнить дословно нечего. */
    topicDigest: (limit = 6) => { const c = new Map(); for (const m of memRows()) c.set(m.topics[0], (c.get(m.topics[0]) ?? 0) + 1); return rows("SELECT topic, text FROM topic_summaries").filter((r) => c.has(r.topic)).sort((a, b) => c.get(b.topic) - c.get(a.topic)).slice(0, limit).map((r) => ({ topic: r.topic, text: r.text, count: c.get(r.topic) })); },
    /** «Верно»: воспоминание помогло, укрепляем. */
    confirmMemory: (id) => { const m = memRows().find((x) => x.id === id); if (!m) return null; db.run("UPDATE memories SET strength = ?, updated_at = ?, used_at = ?, src = 'user', ev_against = MAX(0, ev_against - 1) WHERE id = ?", [Math.min(20, m.strength + 1), now(), now(), id]); save(); return { ok: true }; },
    /** «Неверно, вот как правильно»: новая запись вместо старой, старая остаётся в истории. */
    correctMemory: (id, text) => {
      const m = memRows().find((x) => x.id === id); text = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200); if (!m || text.length < 6) return null;
      db.run("INSERT INTO memories(text, topics, kind, strength, chat_id, created_at, updated_at, used_at, pinned, valid_from, learned_at, src, importance, mtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)", [text, m.topics.join(","), m.kind, m.strength, m.chatId ?? null, now(), now(), now(), m.pinned ? 1 : 0, null, now(), m.importance ?? null, m.mtype ?? null]);
      const nid = rows("SELECT last_insert_rowid() AS id")[0].id;
      db.run("INSERT OR IGNORE INTO mem_entities(memory_id, entity_id) SELECT ?, entity_id FROM mem_entities WHERE memory_id = ?", [nid, id]);
      db.run("UPDATE memories SET state = 'replaced', replaced_by = ? WHERE id = ?", [nid, id]); db.run("INSERT OR IGNORE INTO causal(cause, effect) SELECT ?, effect FROM causal WHERE cause = ?", [nid, id]); cascadeDoubt(id); save(); return { ok: true, id: nid };
    },
    /** Ночная уборка: сливаем только почти одинаковые (текст совпал или слова совпали на 80%). Остальное решает человек. */
    autoMerge: () => {
      let n = 0;
      for (const g of dupGroups(true)) { const r = mergeNow(g.keep, g.items.map((i) => i.id).filter((i) => i !== g.keep)); if (r) n += r.merged; }
      return n;
    },
    /** Привычные связи со временем ослабевают, если их не повторять. */
    sleepMaintain: () => { db.run("UPDATE link_weights SET w = w * 0.85"); db.run("DELETE FROM link_weights WHERE w < 0.5"); cache = null; store.save(); },
    getMeta: (k) => rows("SELECT value FROM meta WHERE key = ?", [k])[0]?.value ?? null,
    setMeta: (k, v) => { db.run("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, String(v)]); store.save(); },
    getRecallCfg: () => ({ weights: { ...W }, rerank: rows("SELECT value FROM meta WHERE key = 'rerank'")[0]?.value === "1" }),
    setRecallCfg: ({ weights, rerank }) => {
      if (weights) { const n = (v, d) => (Number.isFinite(Number(v)) ? Math.min(2, Math.max(0, Number(v))) : d); W = { vec: n(weights.vec, W.vec), lex: n(weights.lex, W.lex), imp: n(weights.imp, W.imp) }; db.run("INSERT INTO meta(key, value) VALUES ('weights', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(W)]); }
      if (rerank !== undefined) db.run("INSERT INTO meta(key, value) VALUES ('rerank', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [rerank ? "1" : "0"]);
      store.save();
    },
    disputes: () => { const by = new Map(memRows().map((m) => [m.id, m])); return rows("SELECT a, b, reason FROM disputes WHERE state = 'open' ORDER BY created_at DESC LIMIT 50").filter((r) => by.has(r.a) && by.has(r.b)).map((r) => ({ a: { id: r.a, text: by.get(r.a).text }, b: { id: r.b, text: by.get(r.b).text }, reason: r.reason })); },
    /** keep: id верного (второй уйдёт в историю) или null — «оба верны». */
    resolveDispute: (a, b, keep) => {
      const x = Math.min(a, b), y = Math.max(a, b);
      if (keep === x || keep === y) { const lose = keep === x ? y : x; db.run("UPDATE memories SET ev_against = ev_against + 2 WHERE id = ?", [lose]); db.run("UPDATE memories SET strength = MIN(20, strength + 1) WHERE id = ?", [keep]); cascadeDoubt(lose); mergeNow(keep, [lose], true); db.run("DELETE FROM disputes WHERE a = ? AND b = ?", [x, y]); }
      else db.run("UPDATE disputes SET state = 'ignored' WHERE a = ? AND b = ?", [x, y]);
      save(); return { ok: true };
    },
    /** После расчёта векторов: настоящий дубль (близкий смысл и слова) сливаем, «похоже, но спорит» отправляем в споры. */
    dedupeNew: (ids) => {
      let merged = 0, disputed = 0;
      for (const id of ids) {
        const me = memRows().find((m) => m.id === id); if (!me?.vec) continue;
        let best = null, bs = 0; for (const m of memRows()) { if (m.id === id || !m.vec) continue; const sm = dot(me.vec, m.vec); if (sm > bs) { bs = sm; best = m; } }
        if (!best || bs < 0.93) continue;
        const why = conflictReason(me.text, best.text);
        if (why) { addDispute(id, best.id, why); disputed++; }
        else if (jaccard(meta(me).w, meta(best).w) >= 0.3 || bs >= 0.97) { const keep = best.id < id ? best : me, drop = keep === best ? me : best; if (mergeNow(keep.id, [drop.id])) merged++; }
      }
      return { merged, disputed };
    },
    /** Скопления по смыслу: k-средних по векторам (центры считаем по выборке, потом раскладываем все), независимо от тем, которые дала модель. */
    /** Срез на дату: что я уже знала в тот день и что тогда ещё было верно (двойное время: «когда верно» и «когда узнала»). */
    asOf: (date, q = "", limit = 60) => {
      const d = vdate(date); if (!d) return null;
      const end = Date.parse(d.length === 10 ? d + "T23:59:59.999Z" : d.slice(0, 7) + "-28T23:59:59.999Z"), all = memRows(true), byId = new Map(all.map((m) => [m.id, m])), qw = wordsOf(q);
      const learned = (m) => Date.parse(m.learnedAt ?? m.createdAt) || 0, day = (x) => (x.length === 7 ? x + "-28" : x);
      const out = all.filter((m) => {
        if (learned(m) > end || (m.state === "archived")) return false;
        if (m.validFrom && Date.parse(day(m.validFrom)) > end) return false;
        if (m.validTo && Date.parse(day(m.validTo) + "T23:59:59.999Z") < end) return false;
        if (m.state === "replaced") { const nx = byId.get(m.replacedBy); if (!nx || learned(nx) <= learned(m) || learned(nx) <= end) return false; } // заменённый факт был «живым» до появления замены
        return !qw.size || [...qw].some((w) => meta(m).w.has(w) || m.topics.some((t) => t.startsWith(w.slice(0, 4))));
      }).sort((a, b) => b.strength - a.strength || learned(b) - learned(a));
      return { date: d, total: out.length, items: out.slice(0, limit).map((m) => ({ id: m.id, text: m.text, topics: m.topics, learnedAt: m.learnedAt ?? m.createdAt, validFrom: m.validFrom, validTo: m.validTo, replaced: m.state === "replaced" })) };
    },
    /** Выводы модели и записи «по инструменту», ждущие подтверждения. */
    hypotheses: () => { const by = new Map(memRows().map((m) => [m.id, m])); return memRows().filter(unconfirmed).sort((a, b) => b.id - a.id).map((m) => { let pr = []; try { pr = JSON.parse(m.proof ?? "[]"); } catch { /* нет */ } return { id: m.id, text: m.text, topics: m.topics, src: m.src, at: m.at, proof: pr.map((i) => by.get(i)).filter(Boolean).map((x) => ({ id: x.id, text: x.text })) }; }); },
    setProof: (id, ids) => { db.run("UPDATE memories SET proof = ? WHERE id = ?", [JSON.stringify((ids ?? []).filter(Number.isInteger).slice(0, 10)), id]); store.save(); },
    /** Похожее на новый факт — кандидаты, с которыми модель решает: то же, обновление, противоречие или новое. */
    similarTo: (text, topics = [], k = 4) => {
      const idx = wordIdx(), w = wordsOf(text), tp = cleanTopics(topics);
      const pool = new Map(sharedCandidates(idx, w).map((m) => [m.id, m])); if (tp.length) for (const m of memRows()) if (!pool.has(m.id) && m.topics.some((t) => tp.includes(t)) && pool.size < 400) pool.set(m.id, m);
      return [...pool.values()].map((m) => [Math.max(jaccard(meta(m).w, w), soft(w, meta(m).w)) + (m.topics.some((t) => tp.includes(t)) ? 0.15 : 0), m]).filter(([sc]) => sc >= 0.3).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, m]) => ({ id: m.id, text: m.text, pinned: m.pinned }));
    },
    /** Решения модели при записи: ADD/NOOP/UPDATE/DELETE/DOUBT по каждому факту. Неверный id или отсутствие решения — обычное добавление. */
    decide: (facts, decisions, chatId = null, opts = {}) => {
      const alive = new Map(memRows().map((m) => [m.id, m])), dec = new Map(); let upd = 0, closed = 0, doubted = 0;
      for (const d of Array.isArray(decisions) ? decisions : []) { const i = Number(d?.i); if (Number.isInteger(i) && i >= 0 && i < facts.length && !dec.has(i)) dec.set(i, { op: String(d?.op ?? "").toUpperCase(), id: Number(d?.id) }); }
      const noop = new Set(), f2 = facts.map((f, i) => { const d = dec.get(i); if (d?.op === "NOOP" && alive.has(d.id)) { noop.add(i); return { skip: d.id }; } return f; });
      for (const i of noop) { const m = alive.get(dec.get(i).id); db.run("UPDATE memories SET strength = ?, updated_at = ?, src = CASE WHEN src IN ('reflect','tool') AND ? = 'chat' THEN 'chat' ELSE src END WHERE id = ?", [Math.min(20, m.strength + 1), now(), opts.src ?? "chat", m.id]); }
      const r = api.remember(f2, chatId, opts);
      for (const [i, d] of dec) {
        const nid = r.ids[i], old = alive.get(d.id); if (!nid || !old || noop.has(i) || nid === old.id) continue;
        const op = old.pinned && (d.op === "UPDATE" || d.op === "DELETE") ? "DOUBT" : d.op;
        if (op === "UPDATE") { db.run("UPDATE memories SET state = 'replaced', replaced_by = ? WHERE id = ?", [nid, old.id]); db.run("INSERT OR IGNORE INTO causal(cause, effect) SELECT ?, effect FROM causal WHERE cause = ?", [nid, old.id]); cascadeDoubt(old.id); upd++; }
        else if (op === "DELETE") { db.run("UPDATE memories SET state = 'replaced', replaced_by = ?, valid_to = COALESCE(valid_to, ?), ev_against = ev_against + 2 WHERE id = ?", [nid, now().slice(0, 10), old.id]); cascadeDoubt(old.id); closed++; }
        else if (op === "DOUBT") { db.run("UPDATE memories SET ev_against = ev_against + 1 WHERE id = ?", [old.id]); addDispute(nid, old.id, "возможное противоречие"); doubted++; }
      }
      if (noop.size) r.strengthened += noop.size; if (upd || closed || doubted || noop.size) save();
      return { ...r, updated: upd, closed, doubted, same: noop.size };
    },
    /** Причины и следствия: что вытекает из этого факта и из чего он. */
    causes: (id) => ({ causes: rows("SELECT cause AS id FROM causal WHERE effect = ?", [id]).map((r) => r.id), effects: rows("SELECT effect AS id FROM causal WHERE cause = ?", [id]).map((r) => r.id) }),
    /** Хронология по теме или слову: сначала старое. */
    timeline: (q = "", limit = 12) => {
      const qw = wordsOf(q), qn = norm(q), day = (m) => m.validFrom ?? String(m.createdAt ?? m.at).slice(0, 10);
      return memRows().filter((m) => !qw.size || [...qw].some((w) => meta(m).w.has(w)) || m.topics.some((t) => qn.includes(t))).sort((a, b) => day(a).localeCompare(day(b)) || a.id - b.id).slice(-limit).map((m) => ({ id: m.id, text: m.text, when: day(m), past: Boolean(m.validTo && Date.parse(m.validTo) < Date.now()) }));
    },
    /** Сроки: что наступает в ближайшие дни или уже просрочено и о чём ещё не напоминали. */
    reminders: (days = 3) => {
      let seen = {}; try { seen = JSON.parse(rows("SELECT value FROM meta WHERE key = 'notified'")[0]?.value ?? "{}"); } catch { /* пусто */ }
      const lim = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10), today = now().slice(0, 10);
      return memRows().filter((m) => m.dueAt && m.dueAt <= lim && seen[m.id] !== m.dueAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 10).map((m) => ({ id: m.id, text: m.text, due: m.dueAt, overdue: m.dueAt < today }));
    },
    ackReminders: (ids) => { let seen = {}; try { seen = JSON.parse(rows("SELECT value FROM meta WHERE key = 'notified'")[0]?.value ?? "{}"); } catch { /* пусто */ } const by = new Map(memRows().map((m) => [m.id, m])); for (const id of ids ?? []) if (by.get(id)?.dueAt) seen[id] = by.get(id).dueAt; db.run("INSERT INTO meta(key, value) VALUES ('notified', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(seen)]); store.save(); },
    /** Самозаживление: споры с очевидным победителем закрываем сами. Остальное — человеку. */
    heal: () => {
      const by = new Map(memRows().map((m) => [m.id, m])), t = Date.now(); let resolved = 0, left = 0;
      for (const r of rows("SELECT a, b FROM disputes WHERE state = 'open'")) {
        const A = by.get(r.a), B = by.get(r.b); if (!A || !B) continue;
        const past = (m) => Boolean(m.validTo && Date.parse(m.validTo) < t); let keep = null;
        if (A.pinned !== B.pinned) keep = A.pinned ? A : B;
        else if (unconfirmed(A) !== unconfirmed(B)) keep = unconfirmed(A) ? B : A;
        else if (past(A) !== past(B)) keep = past(A) ? B : A;
        else if (Math.abs(A.conf - B.conf) >= 0.3) keep = A.conf > B.conf ? A : B;
        if (keep) { api.resolveDispute(A.id, B.id, keep.id); resolved++; } else left++;
      }
      return { resolved, left };
    },
    /** «Иван П.» и «Иван Петров» — один человек: склеиваем сущности. */
    mergeEntities: () => {
      let n = 0; const ents = rows("SELECT id, key FROM entities");
      for (const e of ents) { const tk = e.key.split(" "); if (tk.length !== 2 || tk[1].length !== 1) continue; const full = ents.filter((o) => o.id !== e.id && o.key.split(" ").length === 2 && o.key.startsWith(tk[0] + " " + tk[1]) && o.key.split(" ")[1].length > 1); if (full.length !== 1) continue; const to = full[0].id;
        db.run("UPDATE OR IGNORE mem_entities SET entity_id = ? WHERE entity_id = ?", [to, e.id]); db.run("UPDATE OR IGNORE relations SET subj = ? WHERE subj = ?", [to, e.id]); db.run("UPDATE OR IGNORE relations SET obj = ? WHERE obj = ?", [to, e.id]); db.run("DELETE FROM entities WHERE id = ?", [e.id]); n++; }
      if (n) save(); return n;
    },
    /** Порядок в темах: мелкие темы вливаем в близкие крупные, перегруженные делим по частому слову. */
    topicHousekeeping: () => {
      const by = new Map(); for (const m of memRows()) { const t = m.topics[0]; by.set(t, [...(by.get(t) ?? []), m]); }
      let merged = 0, split = 0; const rename = (m, from, to) => { const tp = [...new Set(m.topics.map((x) => (x === from ? to : x)))].slice(0, 3); db.run("UPDATE memories SET topics = ? WHERE id = ?", [tp.join(","), m.id]); };
      const stem = (t) => t.slice(0, Math.max(4, t.length - 2));
      for (const [t, ms] of [...by]) {
        if (ms.length > 8 || t.length < 4) continue;
        const big = [...by].filter(([b, bm]) => b !== t && bm.length > ms.length && bm.length > 8 && b.length >= 4 && (stem(b) === stem(t) || b.startsWith(stem(t)) || t.startsWith(stem(b))))[0]; if (!big) continue;
        for (const m of ms) rename(m, t, big[0]); by.set(big[0], [...big[1], ...ms]); by.delete(t); merged++;
      }
      const STOP = new Set(["очень", "который", "которая", "когда", "этого", "есть", "быть", "также", "свой", "своей"]);
      for (const [t, ms] of [...by].sort((a, b) => b[1].length - a[1].length)) {
        if (split >= 2 || ms.length < 150) break;
        const c = new Map(); for (const m of ms) for (const w of meta(m).w) if (w.length >= 5 && !STOP.has(w) && w !== t) c.set(w, (c.get(w) ?? 0) + 1);
        const top = [...c].filter(([, k]) => k >= 25 && k <= ms.length * 0.7).sort((a, b) => b[1] - a[1])[0]; if (!top) continue;
        const nt = cleanTopics([top[0]])[0]; if (!nt || by.has(nt)) continue;
        for (const m of ms) if (meta(m).w.has(top[0])) rename(m, t, nt); split++;
      }
      if (merged || split) save(); return { merged, split };
    },
    /** Что обобщить: темы, в которых набралось 5+ подтверждённых фактов, а вывода по ним ещё не было (или тема заметно выросла). */
    reflectTargets: (limit = 2) => {
      const done = (() => { try { return JSON.parse(rows("SELECT value FROM meta WHERE key = 'reflected'")[0]?.value ?? "{}"); } catch { return {}; } })(), by = new Map();
      if (memRows().filter((m) => m.src === "reflect").length >= 10) return [];
      for (const m of memRows()) { if (unconfirmed(m) || m.mtype === "event") continue; const k = m.topics[0]; by.set(k, [...(by.get(k) ?? []), m]); }
      return [...by].filter(([t, g]) => g.length >= 5 && g.length >= (done[t] ?? 0) + 4).sort((a, b) => b[1].length - a[1].length).slice(0, limit).map(([topic, g]) => ({ topic, n: g.length, items: g.sort((a, b) => b.strength - a.strength).slice(0, 10).map((m) => ({ id: m.id, text: m.text })) }));
    },
    markReflected: (topic, n) => { let d = {}; try { d = JSON.parse(rows("SELECT value FROM meta WHERE key = 'reflected'")[0]?.value ?? "{}"); } catch { /* пусто */ } d[topic] = n; db.run("INSERT INTO meta(key, value) VALUES ('reflected', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(d)]); store.save(); },
    /** Самопроверка: закрытые («было раньше») факты не должны вытеснять актуальные и не должны подаваться без пометки. */
    selfTest(limit = 40) {
      const all = memRows(true), byId = new Map(all.map((m) => [m.id, m])), t = Date.now(), pairs = [];
      for (const m of all) {
        if (m.state === "replaced" && byId.get(m.replacedBy)?.state == null && !byId.get(m.replacedBy)?.validTo) pairs.push({ old: m, cur: byId.get(m.replacedBy) });
        else if (m.state == null && m.validTo && Date.parse(m.validTo) < t) { const w = meta(m).w, cur = all.filter((o) => o.state == null && !o.validTo && o.id !== m.id && o.topics[0] === m.topics[0]).map((o) => [jaccard(w, meta(o).w), o]).sort((a, b) => b[0] - a[0])[0]; if (cur && cur[0] >= 0.25) pairs.push({ old: m, cur: cur[1] }); }
      }
      const bad = []; let checked = 0;
      for (const { old, cur } of pairs.slice(0, limit)) {
        checked++; const res = this.recall(cur.text, 8, null, null, { dry: true }), io = res.findIndex((x) => x.id === old.id), ic = res.findIndex((x) => x.id === cur.id);
        if (io >= 0 && (!res[io].past || (ic >= 0 && io < ic) || ic < 0)) bad.push({ old: old.text, now: cur.text });
      }
      return { checked, ok: checked - bad.length, bad: bad.slice(0, 5) };
    },
    /** Убрать в архив по просьбе модели (обратимо, закреплённые не трогаем). */
    archiveMemory: (id) => { const m = memRows().find((x) => x.id === id); if (!m || m.pinned) return false; db.run("UPDATE memories SET state = 'archived' WHERE id = ?", [id]); save(); return true; },
    clusters: ({ k } = {}) => {
      memRows(); if (cache.cl) return cache.cl;
      const vs = cache.rows.filter((m) => m.vec); const res = { items: [], withVec: vs.length, total: cache.rows.length };
      if (vs.length < 6) return (cache.cl = res);
      const dim = vs[0].vec.length, all = vs.filter((m) => m.vec.length === dim), K = Math.max(2, Math.min(k ?? 24, k ?? Math.round(Math.sqrt(all.length / 2))));
      const sample = all.length > 2500 ? all.filter((_, i) => i % Math.ceil(all.length / 2500) === 0) : all;
      // начальные центры: самый дальний от уже выбранных
      const cents = [Float32Array.from(sample[0].vec, (x) => x * sample[0].vec.s)], minSim = sample.map((m) => dot(m.vec, cents[0]));
      while (cents.length < K) { let bi = 0; for (let i = 1; i < sample.length; i++) if (minSim[i] < minSim[bi]) bi = i; const v = Float32Array.from(sample[bi].vec, (x) => x * sample[bi].vec.s); cents.push(v); sample.forEach((m, i) => { minSim[i] = Math.max(minSim[i], dot(m.vec, v)); }); }
      const nearest = (m) => { let bi = 0, bs = -2; for (let c = 0; c < cents.length; c++) { const sm = dot(m.vec, cents[c]); if (sm > bs) { bs = sm; bi = c; } } return [bi, bs]; };
      for (let it = 0; it < 6; it++) {
        const sums = cents.map(() => new Float32Array(dim)), cnt = cents.map(() => 0);
        for (const m of sample) { const [c] = nearest(m); cnt[c]++; const sc = m.vec.s, a = sums[c]; for (let i = 0; i < dim; i++) a[i] += m.vec[i] * sc; }
        sums.forEach((a, c) => { if (!cnt[c]) return; let n = 0; for (let i = 0; i < dim; i++) n += a[i] * a[i]; n = Math.sqrt(n) || 1; for (let i = 0; i < dim; i++) a[i] /= n; cents[c] = a; });
      }
      const groups = cents.map(() => []); for (const m of all) { const [c, sm] = nearest(m); groups[c].push([sm, m]); }
      res.items = groups.filter((g) => g.length >= 2).map((g, i) => {
        g.sort((a, b) => b[0] - a[0]); const ms = g.map((x) => x[1]), tc = new Map(), wc = new Map();
        for (const m of ms) { tc.set(m.topics[0], (tc.get(m.topics[0]) ?? 0) + 1); for (const w of meta(m).w) wc.set(w, (wc.get(w) ?? 0) + 1); }
        const topics = [...tc].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => ({ t, n })), words = [...wc].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
        return { id: i + 1, size: ms.length, label: [...new Set([topics[0].t, ...words])].join(" · "), topics, mix: topics.length > 1 && topics[1].n >= ms.length * 0.25, tight: Math.round((g.reduce((a, x) => a + x[0], 0) / g.length) * 100) / 100, top: ms.slice(0, 6).map((m) => ({ id: m.id, text: m.text })), ids: ms.slice(0, 200).map((m) => m.id) };
      }).sort((a, b) => b.size - a.size);
      return (cache.cl = res);
    },
    countMemories: () => rows("SELECT count(*) AS n FROM memories WHERE state IS NULL")[0].n,
    /** Последние реплики из всех чатов для сканирования старых бесед. */
    transcript: (limit = 60) => rows("SELECT chat_id AS chatId, role, content FROM (SELECT id, chat_id, role, content FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id", [limit]),
    /**
     * Мозг: темы — узлы-центры, факты — точки вокруг своей темы. Связь — два факта из РАЗНЫХ тем, у которых есть общая тема.
     * Рост: size и сила факта растут с повторами; «strong» у тех, что подтверждались несколько раз.
     */
    memGraph: ({ open = [], perTopic = 14, openCap = 150 } = {}) => {
      const everyone = memRows(), weight = new Map(), openSet = new Set((Array.isArray(open) ? open : []).map(norm));
      for (const m of everyone) m.topics.forEach((t, i) => weight.set(t, (weight.get(t) ?? 0) + m.strength * (i === 0 ? 1 : 0.4)));
      const top = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t), id = new Map(top.map((t, i) => [t, i + 1]));
      // Рост: если памяти много, на карте у каждой темы самые важные воспоминания; остальные раскрываются по запросу (open)
      const groups = new Map(); for (const m of everyone) { const g = m.topics.find((t) => id.has(t)); if (g) groups.set(g, [...(groups.get(g) ?? []), m]); }
      const small = everyone.length <= 300, totals = new Map(), mems = [];
      const rank = (a, b) => Number(b.pinned) - Number(a.pinned) || b.strength - a.strength || Date.parse(b.at) - Date.parse(a.at);
      for (const [g, ms] of groups) { totals.set(g, ms.length); const cap = small ? Infinity : openSet.has(g) ? openCap : perTopic; for (const m of (ms.length > cap ? ms.slice().sort(rank).slice(0, cap) : ms)) mems.push({ ...m, grp: id.get(g) }); }
      const all = everyone;
      const sums = new Map(rows("SELECT topic, text FROM topic_summaries").map((r) => [r.topic, r.text])), shown = new Map(); for (const m of mems) shown.set(m.grp, (shown.get(m.grp) ?? 0) + 1);
      const chats = top.map((t) => { const sh = shown.get(id.get(t)) ?? 0, tot = totals.get(t) ?? 0; return { id: id.get(t), title: t, count: tot, hidden: Math.max(0, tot - sh), ...(sums.has(t) ? { summary: sums.get(t) } : {}) }; }).filter((c) => c.count > 0);
      const day = 86400000, t = Date.now(), tierOf = (m) => { const age = (t - Date.parse(m.at)) / day; return m.pinned || m.strength >= 3 ? "long" : age <= 3 ? "fresh" : age > 14 ? "fading" : "plain"; };
      const messages = mems.map((m) => ({ id: m.id, chatId: m.grp, role: m.kind === "fact" ? "user" : "assistant", preview: m.text, size: Math.round(40 * m.strength), at: m.createdAt, upd: m.at, tier: tierOf(m), pinned: m.pinned, hits: m.strength, src: m.chatId ?? 0, topics: m.topics, past: Boolean(m.validTo && Date.parse(m.validTo) < t), conf: Math.round(m.conf * 100) / 100, against: m.against, quote: m.quote ?? null, dueAt: m.dueAt ?? null, msgId: m.srcMsg ?? null }));
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
      // привычка: часто вспоминались вместе
      const shownIds = new Set(mems.map((m) => m.id));
      for (const [k, w] of linkW()) { if (w < 2) continue; const [a, b] = k.split(":").map(Number); if (!shownIds.has(a) || !shownIds.has(b)) continue; const cur = pairs.get(k); if (cur) { cur.w += Math.min(w, 6) * 0.2; if (!cur.kinds.includes("habit")) cur.kinds.push("habit"); } else pairs.set(k, { a, b, w: 0.6 + Math.min(w, 6) * 0.2, words: ["часто вместе"], kinds: ["habit"] }); }
      // из одной беседы: цепочка воспоминаний, рождённых в одном чате, если они в разных темах
      const byChat = new Map(); for (const m of mems) if (m.chatId) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
      for (const ms of byChat.values()) { ms.sort((x, y) => x.id - y.id); for (let i = 1; i < ms.length; i++) { const a = ms[i - 1], b = ms[i]; if (a.grp === b.grp) continue; const k = Math.min(a.id, b.id) + ":" + Math.max(a.id, b.id), cur = pairs.get(k); if (cur) { if (!cur.kinds.includes("chat")) cur.kinds.push("chat"); } else pairs.set(k, { a: a.id, b: b.id, w: 0.8, words: ["из одной беседы"], kinds: ["chat"] }); } }
      const links = [...pairs.values()].sort((x, y) => y.w - x.w).slice(0, 160), total = all.length, STAGES = [[0, "Зародыш"], [5, "Росток"], [20, "Ученик"], [60, "Знаток"], [150, "Мудрец"]];
      let lv = 0; STAGES.forEach(([n], i) => { if (total >= n) lv = i; });
      return { mode: "memory", chats, messages, links, stats: { memories: total, topics: weight.size, links: links.length, level: lv + 1, levelName: STAGES[lv][1], next: STAGES[lv + 1]?.[0] ?? null } };
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
  return api;
}
