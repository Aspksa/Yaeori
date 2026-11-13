import { createChat, deleteChat, getGraph, getMessages, listChats, sendMessage, type ChatInfo, type Msg } from "./api";
import { mountGraph, type GraphHandle, type Layout } from "./graph";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Минимальная разметка: блоки кода, `код`, **жирный**, переносы строк. Всё остальное экранируется. */
export function renderText(src: string): string {
  const parts = src.split(/```/);
  return parts.map((p, i) => {
    if (i % 2) { const nl = p.indexOf("\n"); return `<pre><code>${esc(nl >= 0 && /^[\w+-]*$/.test(p.slice(0, nl).trim()) ? p.slice(nl + 1) : p)}</code></pre>`; }
    return esc(p).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  }).join("");
}

const LAST = "yaeori:chat:v1";
let draft = "";

export const homeView = () => `<div class="home">
  <section class="card viz" aria-label="Карта беседы">
    <div class="viz-head"><div class="grow"><strong>Карта беседы</strong><small class="muted" id="viz-stats"></small></div>
      <div class="segmented" role="radiogroup" aria-label="Раскладка"><button type="button" role="radio" aria-checked="true" data-layout="rings">Кольца</button><button type="button" role="radio" aria-checked="false" data-layout="star">Звезда</button></div></div>
    <div class="viz-body"><canvas id="graph" role="img" aria-label="Карта сообщений: кольца или лучи из сообщений по чатам"></canvas><div id="graph-tip" class="graph-tip" hidden></div>
      <p class="viz-empty muted" id="viz-empty" hidden>Напишите первое сообщение, и здесь начнёт расти карта беседы.</p>
      <div class="viz-legend muted"><i class="dot you"></i> Вы <i class="dot bot"></i> Yaeori</div></div>
  </section>
  <section class="card chat" aria-label="Чат">
    <div class="chat-head"><select id="chat-select" aria-label="Чат"></select><button class="btn small" id="chat-new" type="button">Новый</button><button class="btn small danger" id="chat-del" type="button" aria-label="Удалить чат">Удалить</button></div>
    <div class="chat-thread" id="thread" aria-live="polite"></div>
    <form class="chat-form" id="chat-form"><textarea id="chat-input" rows="1" maxlength="8000" placeholder="Сообщение…" title="Enter — отправить, Shift+Enter — новая строка" aria-label="Сообщение"></textarea>
      <button class="btn primary" id="chat-send" type="submit">Отправить</button></form>
  </section></div>`;

/** Подключает чат и карту к уже нарисованной главной странице. Возвращает функцию отключения. */
export function mountHome(): () => void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const select = $<HTMLSelectElement>("chat-select"), thread = $("thread"), input = $<HTMLTextAreaElement>("chat-input"), sendBtn = $<HTMLButtonElement>("chat-send");
  const form = $<HTMLFormElement>("chat-form"), stats = $("viz-stats"), empty = $("viz-empty");
  let chats: ChatInfo[] = [], current = 0, busy = false, ctrl: AbortController | null = null, dead = false;
  const graph: GraphHandle = mountGraph($<HTMLCanvasElement>("graph"), $("graph-tip"), { onPick: (id) => void open(id) });

  const bubble = (role: "user" | "assistant" | "error", html: string) => {
    const d = document.createElement("div"); d.className = "msg " + role; d.innerHTML = html; thread.appendChild(d);
    thread.scrollTop = thread.scrollHeight; return d;
  };
  const hello = () => { thread.innerHTML = ""; bubble("assistant", "Здравствуйте! Я Yaeori. О чём поговорим?"); };

  async function refreshGraph() {
    try {
      const g = await getGraph(); if (dead) return;
      graph.update(g); graph.select(current || null);
      stats.textContent = g.messages.length ? `  ·  чатов: ${g.chats.length}, сообщений: ${g.messages.length}` : "";
      empty.hidden = g.messages.length > 0;
    } catch { /* карта необязательна */ }
  }
  async function refreshChats() {
    chats = await listChats(); if (dead) return;
    select.innerHTML = (current ? "" : `<option value="0">Новый чат</option>`) + chats.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
    select.value = String(current);
  }
  async function open(id: number) {
    if (busy || dead) return;
    current = id; try { localStorage.setItem(LAST, String(id)); } catch { /* ignore */ }
    select.value = String(id); graph.select(id);
    const msgs: Msg[] = id ? await getMessages(id) : [];
    if (dead) return;
    if (!msgs.length) hello(); else { thread.innerHTML = ""; for (const m of msgs) bubble(m.role, renderText(m.content)); }
  }
  async function ensureChat(): Promise<number> {
    if (current) return current;
    const { id } = await createChat(); current = id; await refreshChats(); select.value = String(id); return id;
  }
  function setBusy(on: boolean) {
    busy = on; sendBtn.textContent = on ? "Стоп" : "Отправить"; sendBtn.classList.toggle("primary", !on); select.disabled = on;
    $("chat-new").toggleAttribute("disabled", on); $("chat-del").toggleAttribute("disabled", on);
  }

  async function submit() {
    if (busy) { ctrl?.abort(); return; }
    const text = input.value.trim(); if (!text) return;
    input.value = ""; draft = ""; autosize();
    let id: number; try { id = await ensureChat(); } catch (e) { bubble("error", esc((e as Error).message)); return; }
    if (thread.querySelector(".msg.assistant:only-child")) thread.innerHTML = "";
    bubble("user", renderText(text));
    const out = bubble("assistant", '<span class="typing" aria-label="Печатает"><i></i><i></i><i></i></span>');
    let acc = "", frame = 0, failed = false;
    const paint = () => { frame = 0; out.innerHTML = renderText(acc); thread.scrollTop = thread.scrollHeight; };
    ctrl = new AbortController(); setBusy(true);
    try {
      await sendMessage(id, text, (e) => {
        if (e.user) void refreshGraph();
        if (e.delta) { acc += e.delta; if (!frame) frame = requestAnimationFrame(paint); }
        if (e.error) { failed = true; out.className = "msg error"; out.textContent = e.error; }
      }, ctrl.signal);
    } catch (e) { if ((e as Error).name !== "AbortError") { failed = true; out.className = "msg error"; out.textContent = (e as Error).message; } }
    if (frame) cancelAnimationFrame(frame);
    if (!failed) paint(); else if (!acc) { /* сообщение об ошибке уже в пузыре */ }
    ctrl = null; if (!dead) { setBusy(false); void refreshChats(); void refreshGraph(); }
  }

  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; };
  input.value = draft; autosize();
  input.addEventListener("input", () => { draft = input.value; autosize(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void submit(); } });
  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  select.addEventListener("change", () => void open(Number(select.value)));
  $("chat-new").addEventListener("click", () => { if (busy) return; current = 0; try { localStorage.removeItem(LAST); } catch { /* ignore */ } void refreshChats(); hello(); graph.select(null); input.focus(); });
  $("chat-del").addEventListener("click", async () => {
    if (busy || !current || !confirm("Удалить этот чат вместе с сообщениями?")) return;
    await deleteChat(current); current = 0; try { localStorage.removeItem(LAST); } catch { /* ignore */ }
    await refreshChats(); hello(); await refreshGraph();
  });
  document.querySelectorAll<HTMLElement>("[data-layout]").forEach((b) => b.addEventListener("click", () => {
    graph.setLayout(b.dataset.layout as Layout);
    document.querySelectorAll<HTMLElement>("[data-layout]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));

  hello();
  void (async () => {
    try {
      await refreshChats();
      const saved = Number((() => { try { return localStorage.getItem(LAST); } catch { return ""; } })());
      const start = chats.some((c) => c.id === saved) ? saved : 0;
      if (start) await open(start);
      await refreshGraph();
    } catch { bubble("error", "Сервер не отвечает. Запустите Yaeori через Yaeori.bat."); }
  })();

  return () => { dead = true; ctrl?.abort(); graph.destroy(); };
}
