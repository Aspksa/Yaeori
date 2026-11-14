// Локальный сервер Yaeori: раздаёт dist/ (если задан) и хранит настройки подключения.
// Ключи API живут только здесь (data/settings.json), в браузер они не отдаются.
import http from "node:http";
import { HTTP_GUIDE, NET_GUIDE, OTHER_GUIDE, apiMessage, explainHttp, explainNet, other } from "./cloudru-errors.mjs";
import path from "node:path";
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { ChatOpenAICompletions } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MemoryClient } from "mem0ai";

const DEFAULTS = { key: "", model: "", fallbackModel: "", memory: true, baseUrl: "https://api.openai.com/v1", mem0Key: "", mem0UserId: "yaeori-user" };
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
  const view = (s) => ({ keySet: Boolean(s.key), model: s.model, fallbackModel: s.fallbackModel, memory: s.memory !== false, baseUrl: s.baseUrl, mem0KeySet: Boolean(s.mem0Key), mem0UserId: s.mem0UserId });
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
  const textOf = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "").join("") : "";
  const explained = (e) => {
    const code = Number(e?.status ?? e?.statusCode ?? e?.response?.status ?? 0);
    return code ? explainHttp(code, apiMessage(String(e?.message ?? ""))) : explainNet(e);
  };
  const modelClient = (s, model, { temperature = 0.7, maxTokens, timeout = 60000 } = {}) => new ChatOpenAICompletions({
    apiKey: s.key, model, temperature, maxTokens, timeout, maxRetries: 0, configuration: { baseURL: s.baseUrl },
  });
  const modelMessages = (system, history = []) => [new SystemMessage(system), ...history.map((m) => m.role === "assistant" ? new AIMessage(m.content) : new HumanMessage(m.content))];
  const mem0Client = (s) => s.mem0Key ? new MemoryClient({ apiKey: s.mem0Key }) : null;
  const within = (promise, ms) => {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("TimeoutError")), ms); });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  };

  // ——— Память: модель сама выделяет факты из беседы; они становятся нейронами «мозга» ———
  const LEARN = "Ты помогаешь ассистенту запоминать важное о собеседнике. Из реплик выдели устойчивые факты о пользователе и его делах: люди, работа, техника, места, планы, предпочтения, договорённости. "
    + "Не запоминай пароли, ключи, номера карт и документов, здоровье и случайные мелочи. Верни ТОЛЬКО JSON-массив до {N} объектов вида "
    + '{"text":"факт одним предложением","topics":["тема"],"kind":"fact"}. kind: "fact" — факт, "note" — идея или план. topics — 1–3 общие темы по 1–2 слова в нижнем регистре (например: работа, техника, семья, планы). ';
  const askModel = async (s, model, system, user, maxTokens = 500) => {
    try {
      const answer = await modelClient(s, model, { temperature: 0.2, maxTokens, timeout: 40000 }).invoke(modelMessages(system, [{ role: "user", content: user }]));
      return textOf(answer.content);
    } catch (e) { throw Object.assign(new Error(String(e?.message ?? "Ошибка модели")), { explained: explained(e) }); }
  };
  const parseFacts = (txt) => {
    const a = txt.indexOf("["), b = txt.lastIndexOf("]"); if (a < 0 || b <= a) return [];
    try { const arr = JSON.parse(txt.slice(a, b + 1)); return Array.isArray(arr) ? arr : []; } catch { return []; }
  };
  const topicHint = () => { const t = db.memGraph().chats.map((c) => c.title); return t.length ? "Если подходит, бери уже существующие темы: " + t.join(", ") + "." : ""; };
  /** Сохраняет диалог в Mem0. Платформа обрабатывает добавление асинхронно. */
  async function saveMem0(s, userText, reply) {
    const client = mem0Client(s); if (!client) return null;
    try {
      await within(client.add([{ role: "user", content: userText }, { role: "assistant", content: reply }], { userId: s.mem0UserId }), 15000);
      return { queued: true };
    } catch (e) { return { error: explained(e) }; }
  }
  /** Выделяет факты из одной реплики и сохраняет. Ошибка не мешает чату. */
  async function learn(s, model, id, userText, reply) {
    const mem0 = saveMem0(s, userText, reply);
    let local;
    try {
      const sys = LEARN.replace("{N}", "4") + topicHint() + " Если запоминать нечего, верни [].";
      const txt = await askModel(s, model, sys, `Пользователь: ${userText.slice(0, 1500)}\n\nОтвет ассистента: ${reply.slice(0, 700)}`);
      local = db.remember(parseFacts(txt), id);
    } catch (e) { local = { error: e?.explained ?? explained(e) }; }
    const saved = await mem0;
    return saved?.error ? { ...local, mem0Error: saved.error } : local;
  }
  /** Читает последние реплики пользователя из всех бесед и вспоминает из них факты (без усиления повторов). */
  async function scanOld(s) {
    const lines = db.transcript(80).filter((m) => m.role === "user").map((m) => "- " + m.content.replace(/\s+/g, " ").slice(0, 300));
    if (!lines.length) return { added: 0, strengthened: 0, empty: true };
    const sys = LEARN.replace("{N}", "12") + topicHint() + " Если запоминать нечего, верни [].";
    const txt = await askModel(s, s.model, sys, "Реплики пользователя из прошлых бесед:\n" + lines.join("\n").slice(0, 7000), 900);
    return db.remember(parseFacts(txt), null, { boost: false });
  }
  const memoryNote = async (s, text) => {
    const local = db.recall(text, 12).map((m) => m.text);
    const client = mem0Client(s);
    let cloud = [];
    if (client) {
      try {
        const found = await within(client.search(text, { filters: { user_id: s.mem0UserId }, topK: 12 }), 8000);
        cloud = (found?.results ?? []).map((m) => String(m?.memory ?? "").trim()).filter(Boolean);
      } catch { /* Mem0 не должен мешать основному ответу. */ }
    }
    const memories = [...new Set([...local, ...cloud])].slice(0, 12);
    if (!memories.length) return "";
    return "\n\nТы помнишь о собеседнике из прошлых бесед (используй естественно, не пересказывай список):\n" + memories.map((m) => "- " + m).join("\n");
  };

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
    const history = db.recent(id, 20).map((m) => ({ role: m.role, content: m.content })), system = SYSTEM + (s.memory !== false ? await memoryNote(s, text) : "");
    const order = [s.model, ...(s.fallbackModel && s.fallbackModel !== s.model ? [s.fallbackModel] : [])];
    let lastErr = null;
    for (let mi = 0; mi < order.length; mi++) {
      const model = order[mi];
      if (mi > 0 && lastErr) send({ notice: `Основная модель не ответила (${lastErr.error}). Отвечает запасная: ${model}` });
      const out = await attempt(s, model, history, system, ctrl, send);
      if (out.ok) {
        send({ assistant: db.addMessage(id, "assistant", out.text), done: true });
        if (s.memory !== false && !ctrl.signal.aborted) {
          const brain = await learn(s, model, id, text, out.text);
          if (brain.mem0Error) send({ notice: `Mem0 не сохранил память: ${brain.mem0Error.error}` });
          send({ brain });
        }
        return res.end();
      }
      if (out.partial) { db.addMessage(id, "assistant", out.partial); }
      if (out.aborted) return res.end();
      lastErr = out.err;
      if (out.partial || [401, 402].includes(lastErr.code)) break; // ключ и оплата одинаковы для любой модели
    }
    send(lastErr);
    res.end();
  }

  /** Один запрос к модели через LangChain. Ошибка до первого слова позволяет перейти к запасной модели. */
  async function attempt(s, model, history, system, ctrl, send) {
    let full = "";
    try {
      const stream = await modelClient(s, model).stream(modelMessages(system, history), { signal: ctrl.signal });
      for await (const chunk of stream) {
        const delta = textOf(chunk.content);
        if (delta) { full += delta; send({ delta }); }
      }
      if (!full.trim()) return { err: other("EMPTY") };
      return { ok: true, text: full };
    } catch (e) {
      if (ctrl.signal.aborted) return { aborted: true, partial: full.trim() ? full : undefined, err: other("EMPTY") }; // остановили сами
      return { err: explained(e), partial: full.trim() ? full : undefined };
    }
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
    if (pathname === "/api/brain" && req.method === "GET") return json(res, 200, db.memGraph());
    if (pathname === "/api/memories" && req.method === "GET") return json(res, 200, { memory: read().memory !== false, total: db.countMemories(), items: db.listMemories().slice(0, 100).map((m) => ({ id: m.id, text: m.text, topics: m.topics, hits: m.strength, at: m.at })) });
    if (pathname === "/api/memories" && req.method === "DELETE") { db.clearMemories(); return json(res, 200, { ok: true }); }
    if (pathname === "/api/memories/scan" && req.method === "POST") {
      const s = read(); if (!s.key) return json(res, 200, { ok: false, ...other("NO_KEY") }); if (!s.model) return json(res, 200, { ok: false, ...other("NO_MODEL") });
      try { return json(res, 200, { ok: true, ...(await scanOld(s)) }); } catch (e) { return json(res, 200, { ok: false, ...(e?.explained ?? explainNet(e)) }); }
    }
    const mm = /^\/api\/memories\/(\d+)$/.exec(pathname);
    if (mm && req.method === "DELETE") { db.deleteMemory(Number(mm[1])); return json(res, 200, { ok: true }); }
    if (pathname === "/api/settings" && req.method === "GET") return json(res, 200, view(read()));
    if (pathname === "/api/settings" && req.method === "PUT") {
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const s = read();
      if (b.key === null) s.key = ""; else if (str(b.key, 400) !== undefined && str(b.key, 400) !== "") s.key = str(b.key, 400);
      if (b.mem0Key === null) s.mem0Key = ""; else if (str(b.mem0Key, 400) !== undefined && str(b.mem0Key, 400) !== "") s.mem0Key = str(b.mem0Key, 400);
      for (const k of ["model", "fallbackModel"]) if (str(b[k], 200) !== undefined) s[k] = str(b[k], 200);
      if (str(b.mem0UserId, 120) !== undefined) s.mem0UserId = str(b.mem0UserId, 120) || DEFAULTS.mem0UserId;
      if (typeof b.memory === "boolean") s.memory = b.memory;
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
