// Локальный сервер Yaeori: раздаёт dist/ (если задан) и хранит настройки подключения.
// Ключ Cloud.ru живёт только здесь (data/settings.json), в браузер он не отдаётся.
import http from "node:http";
import { HTTP_GUIDE, NET_GUIDE, OTHER_GUIDE, apiMessage, explainHttp, explainNet, other } from "./cloudru-errors.mjs";
import path from "node:path";
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const DEFAULTS = { key: "", model: "", fallbackModel: "", memory: true, embedModel: "", baseUrl: "https://foundation-models.api.cloud.ru/v1" };
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
  const view = (s) => ({ keySet: Boolean(s.key), model: s.model, fallbackModel: s.fallbackModel, embedModel: s.embedModel ?? "", memory: s.memory !== false, baseUrl: s.baseUrl });
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

  // ——— Память: модель сама выделяет факты из беседы; они становятся нейронами «мозга» ———
  const LEARN = "Ты помогаешь ассистенту запоминать важное о собеседнике. Из реплик выдели устойчивые факты о пользователе и его делах: люди, работа, техника, места, планы, предпочтения, договорённости. "
    + "Не запоминай пароли, ключи, номера карт и документов, здоровье и случайные мелочи. Верни ТОЛЬКО JSON-массив до {N} объектов вида "
    + '{"text":"факт одним предложением","topics":["тема"],"kind":"fact"}. kind: "fact" — факт, "note" — идея или план. topics — 1–3 общие темы по 1–2 слова в нижнем регистре (например: работа, техника, семья, планы). '
    + 'Можно добавить поля: "entities":["Имя","Место"] — до 4 людей, мест, организаций и техники, названных в факте (как в тексте); "rel":{"s":"кто","r":"отношение в 1–2 слова","o":"с кем или чем"} — если факт связывает две сущности; "from" и "until" в виде "ГГГГ-ММ" — если названо, с какого и до какого времени факт верен. ';
  const askModel = async (s, model, system, user, maxTokens = 500) => {
    const r = await fetch(s.baseUrl + "/chat/completions", { method: "POST", redirect: "error", signal: AbortSignal.timeout(40000),
      headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    if (!r.ok) { const txt = await r.text().catch(() => ""); const e = explainHttp(r.status, apiMessage(txt)); throw Object.assign(new Error(e.error), { explained: e }); }
    const j = await r.json().catch(() => ({}));
    return String(j?.choices?.[0]?.message?.content ?? "");
  };
  // ——— Векторы: эмбеддинги по OpenAI-совместимому /embeddings ———
  let embedAuto = { at: 0, model: "" }, embedState = { ok: null, error: "", model: "" };
  const norm1 = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
  async function embedModelFor(s) {
    if (s.embedModel) return s.embedModel;
    if (Date.now() - embedAuto.at < 600000) return embedAuto.model;
    embedAuto = { at: Date.now(), model: "" };
    try {
      const r = await fetch(s.baseUrl + "/models", { headers: { authorization: `Bearer ${s.key}` }, signal: AbortSignal.timeout(10000), redirect: "error" });
      const ids = r.ok ? ((await r.json().catch(() => ({})))?.data ?? []).map((m) => m?.id).filter((x) => typeof x === "string") : [];
      embedAuto.model = ids.find((x) => /embed|bge|e5|gte/i.test(x)) ?? "";
    } catch { /* без модели эмбеддингов работает поиск по словам */ }
    return embedAuto.model;
  }
  async function embed(s, texts, timeout = 30000) {
    const model = await embedModelFor(s);
    if (!model) { embedState = { ok: false, error: "Модель эмбеддингов не найдена. Укажите её в настройках памяти.", model: "" }; throw Object.assign(new Error("NO_EMBED"), { explained: { error: embedState.error } }); }
    const r = await fetch(s.baseUrl + "/embeddings", { method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout), headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: texts }) });
    if (!r.ok) { const txt = await r.text().catch(() => ""); const e = explainHttp(r.status, apiMessage(txt)); embedState = { ok: false, error: e.error, model }; throw Object.assign(new Error(e.error), { explained: e }); }
    const j = await r.json().catch(() => ({})), out = (j?.data ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => Array.isArray(d?.embedding) ? norm1(d.embedding) : null);
    if (out.length !== texts.length || out.some((x) => !x)) { embedState = { ok: false, error: "Ответ эмбеддингов не распознан", model }; throw new Error("BAD_EMBED"); }
    embedState = { ok: true, error: "", model }; return out;
  }
  /** Досчитывает векторы для воспоминаний без них (до limit штук). Ошибка не мешает работе. */
  async function indexVectors(s, limit = 64) {
    let done = 0;
    try { while (done < limit) { const batch = db.missingVecs(Math.min(16, limit - done)); if (!batch.length) break; const vecs = await embed(s, batch.map((m) => m.text)); db.setVecs(batch.map((m, i) => [m.id, vecs[i]])); done += batch.length; } }
    catch { /* состояние в embedState */ }
    return done;
  }
  const parseFacts = (txt) => {
    const a = txt.indexOf("["), b = txt.lastIndexOf("]"); if (a < 0 || b <= a) return [];
    try { const arr = JSON.parse(txt.slice(a, b + 1)); return Array.isArray(arr) ? arr : []; } catch { return []; }
  };
  const topicHint = () => { const t = db.memGraph().chats.map((c) => c.title); return t.length ? "Если подходит, бери уже существующие темы: " + t.join(", ") + "." : ""; };
  /** Выделяет факты из одной реплики и сохраняет. Ошибка не мешает чату. */
  async function learn(s, model, id, userText, reply) {
    try {
      const sm = db.getSummary(id)?.text;
      const sys = LEARN.replace("{N}", "4") + topicHint() + " Если запоминать нечего, верни [].";
      const txt = await askModel(s, model, sys, `${sm ? `Кратко о беседе до этого: ${sm.slice(0, 600)}\n\n` : ""}Пользователь: ${userText.slice(0, 1500)}\n\nОтвет ассистента: ${reply.slice(0, 700)}`);
      const res = db.remember(parseFacts(txt), id);
      if (res.addedIds?.length) await indexVectors(s, 16);
      return res;
    } catch (e) { return { error: e?.explained ?? explainNet(e) }; }
  }
  /** Читает последние реплики пользователя из всех бесед и вспоминает из них факты (без усиления повторов). */
  async function scanOld(s) {
    const lines = db.transcript(80).filter((m) => m.role === "user").map((m) => "- " + m.content.replace(/\s+/g, " ").slice(0, 300));
    if (!lines.length) return { added: 0, strengthened: 0, empty: true };
    const sys = LEARN.replace("{N}", "12") + topicHint() + " Если запоминать нечего, верни [].";
    const txt = await askModel(s, s.model, sys, "Реплики пользователя из прошлых бесед:\n" + lines.join("\n").slice(0, 7000), 900);
    const res = db.remember(parseFacts(txt), null, { boost: false });
    if (res.addedIds?.length) await indexVectors(s, 64);
    return res;
  }
  /** Скользящее резюме: всё, что старше последних 10 сообщений, сжимается в короткий пересказ (обновляется, когда набралось 8 новых). */
  const KEEP_LIVE = 10, SUM_BATCH = 8, sumBusy = new Set();
  async function summarize(s, model, id) {
    if (sumBusy.has(id)) return; sumBusy.add(id);
    try {
      const prev = db.getSummary(id), upto = prev?.upto ?? 0, total = db.messageCount(id); if (total < KEEP_LIVE + SUM_BATCH) return;
      const fresh = db.messagesAfter(id, upto, 60), cover = fresh.slice(0, Math.max(0, fresh.length - KEEP_LIVE)); if (cover.length < SUM_BATCH) return;
      const sys = "Ты ведёшь краткий пересказ беседы. Обнови пересказ: сохрани важные факты, решения, договорённости и открытые вопросы, выбрось мелочи. Не более 700 символов, по-русски, связным текстом без вступлений.";
      const txt = await askModel(s, model, sys, `${prev ? `Пересказ до этого:\n${prev.text}\n\n` : ""}Новые сообщения:\n${cover.map((m) => (m.role === "user" ? "Пользователь: " : "Ассистент: ") + m.content.replace(/\s+/g, " ").slice(0, 500)).join("\n")}`, 500);
      if (txt?.trim().length >= 20) db.setSummary(id, txt.trim(), cover[cover.length - 1].id);
    } catch { /* резюме не обязательно */ } finally { sumBusy.delete(id); }
  }
  const memoryNote = (mem) => {
    if (!mem.length) return "";
    return "\n\nТы помнишь о собеседнике из прошлых бесед (используй естественно, не пересказывай список):\n" + mem.map((m) => "- " + m.text + (m.past ? ` (было раньше${m.validTo ? ", до " + m.validTo : ""}, сейчас уже не так)` : "")).join("\n");
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
    const sum = db.getSummary(id), history = (sum ? db.messagesAfter(id, sum.upto, 24) : db.recent(id, 20)).map((m) => ({ role: m.role, content: m.content })), mem = s.memory !== false ? db.recall(text, 12, await embed(s, [text], 6000).then((v) => v[0]).catch(() => null), id) : [], system = SYSTEM + memoryNote(mem) + (sum ? "\n\nКратко о том, что было раньше в этой беседе: " + sum.text : "");
    if (mem.length) send({ recalled: mem.map((m) => ({ id: m.id, text: m.text, hop: Boolean(m.hop), session: Boolean(m.session), past: Boolean(m.past) })) });
    const order = [s.model, ...(s.fallbackModel && s.fallbackModel !== s.model ? [s.fallbackModel] : [])];
    let lastErr = null;
    for (let mi = 0; mi < order.length; mi++) {
      const model = order[mi];
      if (mi > 0 && lastErr) send({ notice: `Основная модель не ответила (${lastErr.error}). Отвечает запасная: ${model}` });
      const out = await attempt(s, model, history, system, ctrl, send);
      if (out.ok) {
        send({ assistant: db.addMessage(id, "assistant", out.text), done: true });
        if (s.memory !== false && !ctrl.signal.aborted) send({ brain: await learn(s, model, id, text, out.text) });
        res.end(); void summarize(s, model, id); return;
      }
      if (out.partial) { db.addMessage(id, "assistant", out.partial); }
      if (out.aborted) return res.end();
      lastErr = out.err;
      if (out.partial || [401, 402].includes(lastErr.code)) break; // ключ и оплата одинаковы для любой модели
    }
    send(lastErr);
    res.end();
  }

  /** Один запрос к модели. Возвращает {ok,text} или {err,partial?,aborted?}. Ошибка до первого слова позволяет перейти к запасной модели. */
  async function attempt(s, model, history, system, ctrl, send) {
    const up = new AbortController(); let timedOut = false, timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; up.abort(); }, 60000); };
    const onClient = () => up.abort(); ctrl.signal.addEventListener("abort", onClient);
    let full = "", reasoning = false;
    try {
      arm();
      const r = await fetch(s.baseUrl + "/chat/completions", {
        method: "POST", redirect: "error", signal: up.signal,
        headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json", accept: "text/event-stream, application/json" },
        body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, ...history] }),
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
    if (pathname === "/api/brain" && req.method === "GET") return json(res, 200, db.memGraph());
    if (pathname === "/api/memories" && req.method === "GET") return json(res, 200, { memory: read().memory !== false, total: db.countMemories(), items: db.listMemories().slice(0, 100).map((m) => ({ id: m.id, text: m.text, topics: m.topics, hits: m.strength, at: m.at })) });
    if (pathname === "/api/vectors" && req.method === "GET") { const s = read(); return json(res, 200, { ...db.vecStats(), model: s.embedModel || embedState.model || embedAuto.model || "", ok: embedState.ok, error: embedState.error }); }
    if (pathname === "/api/vectors/build" && req.method === "POST") {
      const s = read(); if (!s.key) return json(res, 200, { ok: false, ...other("NO_KEY") });
      const done = await indexVectors(s, 128); return json(res, 200, { ok: embedState.ok !== false, done, ...db.vecStats(), model: s.embedModel || embedState.model || embedAuto.model || "", error: embedState.error });
    }
    if (pathname === "/api/memories" && req.method === "DELETE") { db.clearMemories(); return json(res, 200, { ok: true }); }
    if (pathname === "/api/memories/scan" && req.method === "POST") {
      const s = read(); if (!s.key) return json(res, 200, { ok: false, ...other("NO_KEY") }); if (!s.model) return json(res, 200, { ok: false, ...other("NO_MODEL") });
      try { return json(res, 200, { ok: true, ...(await scanOld(s)) }); } catch (e) { return json(res, 200, { ok: false, ...(e?.explained ?? explainNet(e)) }); }
    }
    if (pathname === "/api/export" && req.method === "GET") return json(res, 200, db.exportAll());
    if (pathname === "/api/import" && req.method === "POST") {
      let b; try { b = await body(req, 80 * 1024 * 1024); } catch { return json(res, 400, { error: "Файл слишком большой или повреждён" }); }
      const r = db.importAll(b); if (r.error) return json(res, 400, r);
      setTimeout(() => void tick(), 500); return json(res, 200, r);
    }
    if (pathname === "/api/memories/review" && req.method === "POST") {
      const s = read(), out = { merges: db.duplicateGroups(), conflicts: [], conflictsError: null };
      if (s.key && s.model) {
        const texts = db.memoryTexts(60);
        if (texts.length >= 2) try {
          const sys = "Ты проверяешь список фактов о пользователе. Найди пары, которые ПРОТИВОРЕЧАТ друг другу (нельзя быть правдой обоим, например разные города проживания или разные должности). Похожие, но не противоречащие факты не включай. Верни ТОЛЬКО JSON вида {\"conflicts\":[{\"a\":id,\"b\":id,\"why\":\"коротко почему\"}]}. Если противоречий нет, верни {\"conflicts\":[]}.";
          const txt = await askModel(s, s.model, sys, texts.map((m) => `${m.id}: ${m.text}`).join("\n"), 700), a = txt.indexOf("{"), b = txt.lastIndexOf("}"), ids = new Set(texts.map((m) => m.id));
          const arr = a >= 0 && b > a ? JSON.parse(txt.slice(a, b + 1))?.conflicts : [];
          out.conflicts = (Array.isArray(arr) ? arr : []).filter((c) => ids.has(Number(c?.a)) && ids.has(Number(c?.b)) && c.a !== c.b).slice(0, 20).map((c) => ({ a: { id: Number(c.a), text: texts.find((m) => m.id === Number(c.a)).text }, b: { id: Number(c.b), text: texts.find((m) => m.id === Number(c.b)).text }, why: String(c.why ?? "").slice(0, 160) }));
        } catch (e) { out.conflictsError = e?.explained?.error ?? "Противоречия не проверены: ответ модели не распознан"; }
      } else out.conflictsError = "Для поиска противоречий нужны ключ и модель Cloud.ru";
      out.compress = [];
      if (s.key && s.model) for (const c of db.compressClusters()) try {
        const txt = (await askModel(s, s.model, "Объедини эти факты о пользователе в ОДНО обобщённое утверждение, не потеряв ничего устойчивого. Не более 190 символов, по-русски, одна фраза, без вступлений и кавычек.", c.items.map((m) => "- " + m.text).join("\n"), 160)).trim().replace(/^["«]|["»]$/g, "");
        if (txt.length >= 10 && txt.length <= 200) out.compress.push({ topic: c.topic, ids: c.items.map((m) => m.id), items: c.items.map((m) => m.text), summary: txt });
      } catch { /* пропускаем тему */ }
      return json(res, 200, out);
    }
    if (pathname === "/api/memories/merge" && req.method === "POST") {
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const r = db.mergeMemories(Number(b.keep), (Array.isArray(b.drop) ? b.drop : []).map(Number), b.history === true); if (!r) return json(res, 404, { error: "Нечего объединять" });
      setTimeout(() => void tick(), 300); return json(res, 200, r);
    }
    if (pathname === "/api/entities" && req.method === "GET") return json(res, 200, { items: db.entityList() });
    if (pathname === "/api/memories/inactive" && req.method === "GET") return json(res, 200, { items: db.inactive() });
    if (pathname === "/api/memories/compress" && req.method === "POST") {
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const r = db.compressMemories((Array.isArray(b.ids) ? b.ids : []).map(Number), b.text, String(b.topic ?? "")); if (!r) return json(res, 400, { error: "Нечего сжимать" });
      setTimeout(() => void tick(), 300); return json(res, 200, r);
    }
    const rs = /^\/api\/memories\/(\d+)\/restore$/.exec(pathname);
    if (rs && req.method === "POST") { const r = db.restoreMemory(Number(rs[1])); return r ? json(res, 200, r) : json(res, 404, { error: "Нечего возвращать" }); }
    const mp = /^\/api\/memories\/(\d+)$/.exec(pathname);
    if (mp && req.method === "PUT") {
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const patch = {}; if (typeof b.text === "string") patch.text = b.text; if (Array.isArray(b.topics)) patch.topics = b.topics.map(String); else if (typeof b.topics === "string") patch.topics = b.topics.split(","); if (typeof b.pinned === "boolean") patch.pinned = b.pinned;
      const r = db.updateMemory(Number(mp[1]), patch); if (!r) return json(res, 404, { error: "Такого воспоминания нет" }); if (r.error) return json(res, 400, r);
      setTimeout(() => void tick(), 300); return json(res, 200, r);
    }
    const mm = /^\/api\/memories\/(\d+)$/.exec(pathname);
    if (mm && req.method === "DELETE") { db.deleteMemory(Number(mm[1])); return json(res, 200, { ok: true }); }
    if (pathname === "/api/settings" && req.method === "GET") return json(res, 200, view(read()));
    if (pathname === "/api/settings" && req.method === "PUT") {
      let b; try { b = await body(req); } catch { return json(res, 400, { error: "Некорректный запрос" }); }
      const s = read();
      if (b.key === null) s.key = ""; else if (str(b.key, 400) !== undefined && str(b.key, 400) !== "") s.key = str(b.key, 400);
      for (const k of ["model", "fallbackModel", "embedModel"]) if (str(b[k], 200) !== undefined) s[k] = str(b[k], 200);
      if (typeof b.memory === "boolean") s.memory = b.memory;
      if (str(b.baseUrl, 300) !== undefined) {
        const u = str(b.baseUrl, 300) || DEFAULTS.baseUrl;
        let parsed; try { parsed = new URL(u); } catch { return json(res, 400, { error: "Адрес API указан неверно" }); }
        if (parsed.protocol !== "https:") return json(res, 400, { error: "Адрес API должен начинаться с https://" });
        s.baseUrl = u.replace(/\/+$/, "");
      }
      write(s); embedAuto = { at: 0, model: "" };
      setTimeout(() => void tick(), 300);
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

  // автоматически: векторы досчитываются сами (старт, каждые 10 минут, смена ключа или модели)
  let tickBusy = false;
  const tick = async () => {
    db.decay();
    const s = read(); if (tickBusy || !s.key || s.memory === false) return;
    const st = db.vecStats(); if (!(st.total > st.indexed)) return;
    tickBusy = true; try { for (let i = 0; i < 40; i++) { const n = await indexVectors(s, 128); if (!n) break; } } finally { tickBusy = false; }
  };
  setTimeout(() => void tick(), 4000).unref?.();
  const iv = setInterval(() => void tick(), 600000); iv.unref?.();
  const server = http.createServer((req, res) => {
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
  server.on("close", () => clearInterval(iv));
  return server;
}
