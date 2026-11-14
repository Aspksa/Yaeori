// Запуск Yaeori: зависимости -> типы -> сборка -> свободный порт -> сервер -> браузер.
// Использование: node scripts/launch.mjs [--dev] [--no-open] [--skip-checks] [--port N]
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dev = flag("--dev");
const wantPort = Number(opt("--port") ?? (dev ? 5173 : 4173));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const step = (t) => console.log(`\n\x1b[36m==> ${t}\x1b[0m`);
const die = (m) => { console.error(`\n\x1b[31m[ОШИБКА] ${m}\x1b[0m`); process.exit(1); };
// shell нужен на Windows для .cmd; аргументы здесь только наши, без пользовательского ввода.
const run = (cmd, a) => spawnSync(cmd, a, { cwd: root, stdio: "inherit", shell: process.platform === "win32" }).status === 0;

const packages = ["vite", "sql.js", "@langchain/core", "@langchain/openai", "mem0ai"];
if (packages.some((name) => !existsSync(path.join(root, "node_modules", name)))) { step("Установка зависимостей"); if (!run(npm, ["install", "--no-audit", "--no-fund"])) die("npm install не удался. Проверьте интернет."); }
if (!dev) {
  if (!flag("--skip-checks")) { step("Проверка типов"); if (!run(npm, ["run", "typecheck"])) die("Проверка типов не прошла. Можно запустить с --skip-checks."); }
  step("Сборка"); if (!run(npm, ["run", "build"])) die("Сборка не удалась.");
}

const { createApp } = await import("./server.mjs");
const { openDb } = await import("./db.mjs");
const db = await openDb(root);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { db.flush(); process.exit(0); });
process.on("exit", () => db.flush());
const free = (port) => new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.once("listening", () => s.close(() => resolve(true))); s.listen(port, "127.0.0.1"); });
let port = wantPort;
for (let i = 0; i < 50 && !(await free(port)); i++) port++;
const url = `http://127.0.0.1:${port}/`;
const open = () => {
  if (flag("--no-open")) return;
  const [cmd, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, a, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* браузер откроете сами */ }
};

if (dev) {
  // Vite на wantPort, API на соседнем порту; Vite проксирует /api (см. vite.config.ts).
  let apiPort = port + 1;
  for (let i = 0; i < 50 && !(await free(apiPort)); i++) apiPort++;
  createApp({ root, db }).listen(apiPort, "127.0.0.1");
  step(`Режим разработки, порт ${port} (API ${apiPort})`);
  const child = spawn(npm, ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${apiPort}` } });
  child.on("exit", (c) => process.exit(c ?? 0));
  setTimeout(open, 1500);
} else {
  createApp({ root, db, dist: path.join(root, "dist") }).listen(port, "127.0.0.1", () => {
    console.log(`\n\x1b[32mYaeori работает: ${url}\x1b[0m  (Ctrl+C — остановить)`);
    open();
  });
}
