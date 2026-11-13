// База данных Yaeori: SQLite (sql.js, чистый JS/WASM, без сборки под Windows). Файл: data/yaeori.sqlite3.
// Рабочая копия в памяти, на диск пишется атомарно (временный файл + rename) с небольшой задержкой.
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import initSqlJs from "sql.js";

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
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);`);

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
    /** Данные для карты беседы: чаты и последние сообщения (только начало текста). */
    graph: () => ({
      chats: rows("SELECT c.id, c.title, (SELECT count(*) FROM messages m WHERE m.chat_id = c.id) AS count FROM chats c ORDER BY c.id DESC LIMIT 12"),
      messages: rows("SELECT id, chat_id AS chatId, role, substr(content, 1, 160) AS preview, length(content) AS size, created_at AS at FROM messages WHERE chat_id IN (SELECT id FROM chats ORDER BY id DESC LIMIT 12) ORDER BY id DESC LIMIT 400").reverse(),
    }),
  };
}
