// Локальный сервер Yaeori: раздаёт dist/ (если задан) и хранит настройки подключения.
// Ключ Cloud.ru живёт только здесь (data/settings.json), в браузер он не отдаётся.
import http from "node:http";
import { HTTP_GUIDE, NET_GUIDE, OTHER_GUIDE, apiMessage, explainHttp, explainNet, other } from "./cloudru-errors.mjs";
import path from "node:path";
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const DEFAULTS = { key: "", model: "", fallbackModel: "", baseUrl: "https://foundation-models.api.cloud.ru/v1" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };
const MAX_BODY = 16 * 1024;

export function createApp({ root, db, dist = null }) {
  const file = path.join(root, "data", "settings.json");
  const read = () => { try { return { ...DEFAULTS, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { return { ...DEFAULTS }; } };
  const write = (s) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* не везде поддерживается */ }
  };
  const view = (s) => ({ keySet: Boolean(s.key), model: s.model, fallbackModel: s.fallbackModel, baseUrl: s.baseUrl });
  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(body)); };
  const body = (req, max = MAX_BODY) => new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { raw += c; if (raw.length > max) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);


  const SYSTEM = "Ты Yaeori — спокойная, вежливая помощница. Отвечай по-русски, по делу и дружелюбно.";
  const chatId = (m) => { const id = Number(m); return Number.isInteger(id) && id > 0 ? id : 0; };
  const firstLine = (t) => t.replace(/\s+/g, " ").trim().slice(0, 50) || "Новый чат";

  /** Ответ модели идёт построчно (NDJSON): {"delta":"…"} … {"done":true} или {"error":"…"}. */
  async function streamReply(req, res, id, text) {
    const s = read();
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    const send = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + "\n"); };
    const userId = db.addMessage(id, "user", text);
    send({ user: userId });
    if (db.messages(id).length === 1) db.renameChat(id, firstLine(text));
    if (!s.key) { send(other("NO_KEY")); return res.end(); }
    if (!s.model) { send(other("NO_MODEL")); return res.end(); }
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    const history = db.recent(id, 20).map((m) => ({ role: m.role, content: m.content }));
    const order = [s.model, ...(s.fallbackModel && s.fallbackModel !== s.model ? [s.fallbackModel] : [])];
    let lastErr = null;
    for (let mi = 0; mi < order.length; mi++) {
      const model = order[mi];
      if (mi > 0 && lastErr) send({ notice: `Основная модель не ответила (${lastErr.error}). Отвечает запасная: ${model}` });
      const out = await attempt(s, model, history, ctrl, send);
      if (out.ok) { send({ assistant: db.addMessage(id, "assistant", out.text), done: true }); return res.end(); }
      if (out.partial) { db.addMessage(id, "assistant", out.partial); }
      if (out.aborted) return res.end();
      lastErr = out.err;
      if (out.partial || [401, 402].includes(lastErr.code)) break; // ключ и оплата одинаковы для любой модели
    }
    send(lastErr);
    res.end();
  }

  /** Один запрос к модели. Возвращает {ok,text} или {err,partial?,aborted?}. Ошибка до первого слова позволяет перейти к запасной модели. */
  async function attempt(s, model, history, ctrl, send) {
    const up = new AbortController(); let timedOut = false, timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; up.abort(); }, 60000); };
    const onClient = () => up.abort(); ctrl.signal.addEventListener("abort", onClient);
    let full = "", reasoning = false;
    try {
      arm();
      const r = await fetch(s.baseUrl + "/chat/completions", {
        method: "POST", redirect: "error", signal: up.signal,
        headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json", accept: "text/event-stream, application/json" },
        body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: SYSTEM }, ...history] }),
      });
      if (!r.ok || !r.body) { const txt = await r.text().catch(() => ""); return { err: explainHttp(r.status, apiMessage(txt)) }; }
      if ((r.headers.get("content-type") ?? "").includes("application/json")) {
        const j = await r.json().catch(() => ({})), m = j?.choices?.[0]?.message?.content;
        if (typeof m === "string" && m.trim()) { send({ delta: m }); return { ok: true, text: m }; }
        return { err: other("EMPTY") };
      }
      const dec = new TextDecoder(); let buf = "";
      for await (const chunk of r.body) {
        arm();
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            if (j?.error) return { err: { ...explainHttp(Number(j.error.code) || 500, apiMessage(JSON.stringify(j))), code: Number(j.error.code) || 500 }, partial: full.trim() ? full : undefined };
            const dl = j?.choices?.[0]?.delta;
            if (dl?.reasoning_content || dl?.reasoning) reasoning = true;
            if (typeof dl?.content === "string" && dl.content) { full += dl.content; send({ delta: dl.content }); }
          } catch { /* неполная строка */ }
        }
      }
      if (!full.trim()) return { err: reasoning ? { ...other("EMPTY"), detail: "Модель только рассуждала и не дала ответа." } : other("EMPTY") };
      return { ok: true, text: full };
    } catch (e) {
      if (ctrl.signal.aborted) return { aborted: true, partial: full.trim() ? full : undefined, err: other("EMPTY") }; // остановили сами
      const err = timedOut ? explainNet({ name: "TimeoutError" }) : explainNet(e);
      return { err, partial: full.trim() ? full : undefined };
    } finally { clearTimeout(timer); ctrl.signal.removeEventListener("abort", onClient); }
  }

  async function chats(req, res, pathname) {
    if (pathname === "/api/graph" && req.method === "GET") return json(res, 200, db.graph());
    if (pathname === "/api/chats" && req.method === "GET") return json(res, 200, db.listChats());
    if (pathname === "/api/chats" && req.method === "POST") return json(res, 200, { id: db.createChat() });
    const m = /^\/api\/chats\/(\d+)(\/messages)?$/.exec(pathname);
    if (!m) return json(res, 404, { error: "Не найдено" });
    const id = chatId(m[1]);
    if (!id || !db.chatExists(id)) return json(res, 404, { error: "Чат не найден" });
    if (!m[2] && req.method === "GET") return json(res, 200, db.messages(id));
    if (!m[2] && req.method === "DELETE") { db.deleteChat(id); return json(res, 200, { ok: true }); }
    if (m[2] && req.method === "POST") {
      let b; try { b = await body(req, 64 * 1024); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const text = typeof b.text === "string" ? b.text.trim().slice(0, 8000) : "";
      if (!text) return json(res, 400, { error: "Пустое сообщение" });
      return streamReply(req, res, id, text);
    }
    return json(res, 405, { error: "Метод не поддерживается" });
  }

  async function api(req, res, pathname) {
    // Защита от запросов с чужих сайтов: Origin должен совпадать с Host.
    if (req.method !== "GET") {
      const origin = req.headers.origin;
      if (!origin || new URL(origin).host !== req.headers.host) return json(res, 403, { error: "Запрос с чужого адреса отклонён" });
    }
    if (pathname === "/api/graph" || pathname.startsWith("/api/chats")) return chats(req, res, pathname);
    if (pathname === "/api/settings" && req.method === "GET") return json(res, 200, view(read()));
    if (pathname === "/api/settings" && req.method === "PUT") {
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const s = read();
      if (b.key === null) s.key = ""; else if (str(b.key, 400) !== undefined && str(b.key, 400) !== "") s.key = str(b.key, 400);
      for (const k of ["model", "fallbackModel"]) if (str(b[k], 200) !== undefined) s[k] = str(b[k], 200);
      if (str(b.baseUrl, 300) !== undefined) {
        const u = str(b.baseUrl, 300) || DEFAULTS.baseUrl;
        let parsed; try { parsed = new URL(u); } catch { return json(res, 400, { error: "Адрес API указан неверно" }); }
        if (parsed.protocol !== "https:") return json(res, 400, { error: "Адрес API должен начинаться с https://" });
        s.baseUrl = u.replace(/\/+$/, "");
      }
      write(s);
      return json(res, 200, view(s));
    }
    if (pathname === "/api/errors-guide" && req.method === "GET") return json(res, 200, { http: HTTP_GUIDE, net: NET_GUIDE, other: OTHER_GUIDE });
    if (pathname === "/api/check" && req.method === "POST") {
      const s = read();
      if (!s.key) return json(res, 200, { ok: false, ...other("NO_KEY") });
      try {
        const r = await fetch(s.baseUrl + "/models", { headers: { authorization: `Bearer ${s.key}` }, signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!r.ok) { const txt = await r.text().catch(() => ""); return json(res, 200, { ok: false, ...explainHttp(r.status, apiMessage(txt)) }); }
        const data = await r.json().catch(() => ({}));
        const models = Array.isArray(data?.data) ? [...new Set(data.data.map((m) => m?.id).filter((x) => typeof x === "string"))].slice(0, 500).sort((a, b) => a.localeCompare(b)) : [];
        return json(res, 200, { ok: true, models, modelFound: s.model ? models.includes(s.model) : null, fallbackFound: s.fallbackModel ? models.includes(s.fallbackModel) : null });
      } catch (e) { return json(res, 200, { ok: false, ...explainNet(e) }); }
    }
    if (pathname === "/api/test-model" && req.method === "POST") { // короткий пробный запрос к модели
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const s = read(), model = str(b.model, 200) || s.model;
      if (!s.key) return json(res, 200, { ok: false, ...other("NO_KEY") });
      if (!model) return json(res, 200, { ok: false, ...other("NO_MODEL") });
      const t0 = Date.now();
      try {
        const r = await fetch(s.baseUrl + "/chat/completions", { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
          headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Ответь одним словом: привет" }] }) });
        if (!r.ok) { const txt = await r.text().catch(() => ""); return json(res, 200, { ok: false, model, ...explainHttp(r.status, apiMessage(txt)) }); }
        const j = await r.json().catch(() => ({})), text = j?.choices?.[0]?.message?.content;
        return json(res, 200, { ok: true, model, ms: Date.now() - t0, text: typeof text === "string" ? text.slice(0, 80) : "" });
      } catch (e) { return json(res, 200, { ok: false, model, ...explainNet(e) }); }
    }
    return json(res, 404, { error: "Не найдено" });
  }

  return http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    if (pathname.startsWith("/api/")) { api(req, res, pathname).catch(() => json(res, 500, { error: "Ошибка сервера" })); return; }
    if (!dist) { res.writeHead(404).end(); return; }
    let f;
    try { f = path.join(dist, path.normalize(decodeURIComponent(pathname))); } catch { res.writeHead(400).end(); return; }
    if (!f.startsWith(dist)) { res.writeHead(403).end(); return; }
    if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!existsSync(f)) f = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "x-content-type-options": "nosniff" });
    createReadStream(f).pipe(res);
  });
}
