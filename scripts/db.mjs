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
  const memRows = () => rows("SELECT m.id, m.text, m.topics, m.kind, m.strength, m.chat_id AS chatId, c.title AS chatTitle, m.created_at AS createdAt, m.updated_at AS at FROM memories m LEFT JOIN chats c ON c.id = m.chat_id ORDER BY m.updated_at DESC")
    .map((m) => ({ ...m, topics: String(m.topics).split(",").filter(Boolean) }));

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
      let added = 0, strengthened = 0;
      const existing = memRows();
      for (const f of Array.isArray(facts) ? facts : []) {
        const text = String(f?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200), topics = cleanTopics(f?.topics);
        if (text.length < 6 || !topics.length) continue;
        const kind = f?.kind === "note" ? "note" : "fact", w = wordsOf(text);
        const same = existing.find((m) => norm(m.text) === norm(text) || (m.topics.some((t) => topics.includes(t)) && jaccard(wordsOf(m.text), w) >= 0.6));
        if (same) {
          const merged = [...new Set([...same.topics, ...topics])].slice(0, 3);
          db.run("UPDATE memories SET strength = ?, topics = ?, updated_at = ? WHERE id = ?", [boost ? Math.min(same.strength + 1, 20) : same.strength, merged.join(","), boost ? now() : same.at, same.id]);
          same.topics = merged; if (boost) { same.strength = Math.min(same.strength + 1, 20); strengthened++; }
        } else {
          db.run("INSERT INTO memories(text, topics, kind, strength, chat_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)", [text, topics.join(","), kind, chatId, now(), now()]);
          existing.push({ id: rows("SELECT last_insert_rowid() AS id")[0].id, text, topics, kind, strength: 1, at: now() }); added++;
        }
      }
      if (added || strengthened) save();
      return { added, strengthened };
    },
    /** Какие воспоминания подсказать модели: совпавшие с текущим сообщением, затем сильные и свежие. */
    recall: (text, n = 12) => {
      const q = norm(text), qw = wordsOf(text), day = 86400000, t = Date.now();
      return memRows().map((m) => {
        const hit = m.topics.filter((x) => q.includes(x)).length * 4 + jaccard(wordsOf(m.text), qw) * 6;
        return { m, score: hit + Math.log(1 + m.strength) + Math.exp(-(t - Date.parse(m.at)) / (60 * day)) };
      }).sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.m);
    },
    listMemories: (topic = "") => memRows().filter((m) => !topic || m.topics.includes(norm(topic))).slice(0, 300),
    deleteMemory: (id) => { db.run("DELETE FROM memories WHERE id = ?", [id]); save(); },
    clearMemories: () => { db.run("DELETE FROM memories"); save(); },
    countMemories: () => rows("SELECT count(*) AS n FROM memories")[0].n,
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
      const day = 86400000, t = Date.now(), tierOf = (m) => { const age = (t - Date.parse(m.at)) / day; return m.strength >= 3 ? "long" : age <= 3 ? "fresh" : age > 14 ? "fading" : "plain"; };
      const messages = mems.map((m) => ({ id: m.id, chatId: m.grp, role: m.kind === "fact" ? "user" : "assistant", preview: m.text, size: Math.round(40 * m.strength), at: m.createdAt, upd: m.at, tier: tierOf(m), hits: m.strength, src: m.chatId ?? 0, topics: m.topics }));
      const byTopic = new Map(); for (const m of mems) for (const t of m.topics) byTopic.set(t, [...(byTopic.get(t) ?? []), m]);
      const pairs = new Map();
      for (const [t, ms] of byTopic) { if (ms.length < 2 || ms.length > 14) continue;
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j]; if (a.grp === b.grp) continue;
          const k = Math.min(a.id, b.id) + ":" + Math.max(a.id, b.id), p = pairs.get(k) ?? { a: a.id, b: b.id, w: 0, words: [] }; p.w++; if (p.words.length < 3) p.words.push(t); pairs.set(k, p); } }
      const links = [...pairs.values()].sort((x, y) => y.w - x.w).slice(0, 120), total = all.length, STAGES = [[0, "Зародыш"], [5, "Росток"], [20, "Ученик"], [60, "Знаток"], [150, "Мудрец"]];
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
