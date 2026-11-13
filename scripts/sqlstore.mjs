// Хранилище SQLite с двумя движками под один интерфейс.
// 1) node:sqlite (встроен в Node 22.5+): файл на диске, запись сразу, память не растёт вместе с базой.
// 2) sql.js (чистый JS/WASM): запасной вариант для старых Node. База целиком в памяти, на диск пишется целиком.
// Принудительно запасной: YAEORI_SQLITE=sqljs.
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const clean = (p) => p.map((x) => (x === undefined ? null : typeof x === "boolean" ? Number(x) : x));
const aside = (file) => { try { renameSync(file, file + `.broken-${Date.now()}`); } catch { /* файла уже нет */ } };

async function nodeStore(file) {
  const ew = process.emitWarning; // «ExperimentalWarning» пугает в консоли, а API для нашего набора команд стабилен
  process.emitWarning = (w, ...a) => (String(w?.message ?? w).includes("SQLite") ? undefined : ew.call(process, w, ...a));
  let DatabaseSync; try { ({ DatabaseSync } = await import("node:sqlite")); } finally { process.emitWarning = ew; }
  const open = () => { const d = new DatabaseSync(file); d.exec("PRAGMA schema_version"); return d; };
  let d; try { d = open(); } catch { aside(file); d = open(); } // повреждённый файл откладываем, не затираем
  d.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  return {
    kind: "node:sqlite",
    run: (sql, params = []) => { if (params.length) d.prepare(sql).run(...clean(params)); else d.exec(sql); },
    all: (sql, params = []) => d.prepare(sql).all(...clean(params)).map((r) => ({ ...r })),
    cols: (table) => d.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name),
    save: () => {}, // пишется сразу
    flush: () => { try { d.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* занято */ } },
  };
}

async function sqljsStore(file) {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs();
  let d;
  try { d = new SQL.Database(existsSync(file) ? readFileSync(file) : undefined); }
  catch { aside(file); d = new SQL.Database(); }
  d.run("PRAGMA foreign_keys = ON;");
  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const tmp = file + ".tmp";
    writeFileSync(tmp, Buffer.from(d.export()));
    renameSync(tmp, file);
    d.run("PRAGMA foreign_keys = ON;"); // export() сбрасывает настройки соединения
  };
  return {
    kind: "sql.js",
    run: (sql, params = []) => (params.length ? d.run(sql, clean(params)) : d.run(sql)),
    all: (sql, params = []) => { const st = d.prepare(sql); st.bind(clean(params)); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; },
    cols: (table) => d.exec(`PRAGMA table_info(${table})`)[0]?.values.map((r) => r[1]) ?? [],
    save: () => { if (!timer) timer = setTimeout(flush, 250); },
    flush: () => { if (timer) flush(); },
  };
}

export async function openStore(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (process.env.YAEORI_SQLITE !== "sqljs") { try { return await nodeStore(file); } catch { /* Node старый: идём на запасной */ } }
  return sqljsStore(file);
}
