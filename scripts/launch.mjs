// Запуск Yaeori: зависимости -> типы -> сборка -> свободный порт -> сервер -> браузер.
// Использование: node scripts/launch.mjs [--dev] [--no-open] [--skip-checks] [--port N]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, createReadStream, statSync } from "node:fs";
import http from "node:http";
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

if (!existsSync(path.join(root, "node_modules", "vite"))) { step("Установка зависимостей"); if (!run(npm, ["install", "--no-audit", "--no-fund"])) die("npm install не удался. Проверьте интернет."); }
if (!dev) {
  if (!flag("--skip-checks")) { step("Проверка типов"); if (!run(npm, ["run", "typecheck"])) die("Проверка типов не прошла. Можно запустить с --skip-checks."); }
  step("Сборка"); if (!run(npm, ["run", "build"])) die("Сборка не удалась.");
}

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
  step(`Режим разработки, порт ${port}`);
  const child = spawn(npm, ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (c) => process.exit(c ?? 0));
  setTimeout(open, 1500);
} else {
  const dist = path.join(root, "dist");
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };
  http.createServer((req, res) => {
    let file = path.join(dist, path.normalize(decodeURIComponent((req.url ?? "/").split("?")[0])));
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff" });
    createReadStream(file).pipe(res);
  }).listen(port, "127.0.0.1", () => {
    console.log(`\n\x1b[32mYaeori работает: ${url}\x1b[0m  (Ctrl+C — остановить)`);
    open();
  });
}
