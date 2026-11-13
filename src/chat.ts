import { createChat, deleteChat, getBrain, getConn, getGraph, getMessages, listChats, scanMemories, sendMessage, type ChatInfo, type GraphData, type Msg } from "./api";
import { mountList } from "./list";
import { esc as mdEsc, renderText } from "./md";
export { renderText };
import { buildVectors, compressMemories, forgetMemory, getEntities, getInactive, getVectors, mergeMemories, restoreMemory, reviewMemories, saveConn, updateMemory, type VecInfo } from "./api";
import { AREA_OFF, DEFAULT_MAP, NEURON_OFF, MAP_THEMES, mountGraph, type GraphHandle, type Grouping, type Layout, type MapOptions, type MapTheme, type SysItem } from "./graph";

const esc = mdEsc;

const LAST = "yaeori:chat:v1", MAP_KEY = "yaeori:map:v3";
const LAYOUTS: [Layout, string][] = [["sectors", "Сектора"], ["rings", "Кольца"], ["circle", "Круг"], ["hex", "Соты"], ["tile", "Плита"], ["hud", "HUD"], ["force", "Сила"]];
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);
function loadMap(): MapOptions {
  try {
    const r = JSON.parse(localStorage.getItem(MAP_KEY) ?? "null") as Partial<MapOptions> | null;
    return {
      layout: LAYOUTS.some(([l]) => l === r?.layout) ? r!.layout! : DEFAULT_MAP.layout,
      theme: MAP_THEMES.some((t) => t.id === r?.theme) ? r!.theme! : DEFAULT_MAP.theme,
      rotation: num(r?.rotation, 0, 1, DEFAULT_MAP.rotation), force: num(r?.force, 0, 1, DEFAULT_MAP.force), size: num(r?.size, 0.5, 2, DEFAULT_MAP.size),
      group: r?.group === "day" ? "day" : "chat", labels: r?.labels === true, links: r?.links !== false,
      collapsed: Array.isArray(r?.collapsed) ? r!.collapsed.filter((x): x is string => typeof x === "string").slice(0, 50) : [],
    };
  } catch { return { ...DEFAULT_MAP }; }
}
const saveMap = (o: MapOptions) => { try { localStorage.setItem(MAP_KEY, JSON.stringify(o)); } catch { /* хранилище недоступно */ } };
let draft = "";

export const homeView = () => `<div class="home">
  <section class="card viz" aria-label="Карта беседы">
    <div class="viz-head"><div class="grow"><small class="viz-stats" id="viz-stats"></small></div>
      <button class="btn small" id="viz-list-toggle" type="button" aria-expanded="false" aria-controls="viz-list">☰ Список</button>
      <button class="btn small" id="viz-show" type="button" aria-pressed="false" title="Камера по очереди облетает чаты">▷ Показ</button>
      <button class="btn small" id="viz-toggle" type="button" aria-expanded="false" aria-controls="viz-panel">Настройки карты</button></div>
    <div class="viz-body"><canvas id="graph" role="img" aria-label="Карта мозга: темы, воспоминания и связи между ними"></canvas><div id="graph-tip" class="graph-tip" hidden></div>
      <div class="viz-empty muted" id="viz-empty" hidden><p id="viz-empty-text"></p><button class="btn small primary" id="viz-scan" type="button" hidden>Вспомнить из бесед</button><small id="viz-scan-status" role="status"></small></div>
      <div class="viz-legend muted" id="viz-legend"></div>
      <aside class="viz-list" id="viz-list" hidden aria-label="Список бесед и воспоминаний"></aside>
      <aside class="viz-panel" id="viz-panel" hidden aria-label="Настройки карты">
        <input id="viz-search" type="search" placeholder="Найти на карте…" autocomplete="off" spellcheck="false" aria-label="Поиск по карте" />
        <h3>Раскладка</h3><div class="viz-grid" role="radiogroup" aria-label="Раскладка">${LAYOUTS.map(([id, t]) => `<button type="button" role="radio" aria-checked="false" data-layout="${id}">${t}</button>`).join("")}</div>
        <h3>Вид</h3><div class="viz-grid" role="radiogroup" aria-label="Группировка"><button type="button" role="radio" aria-checked="false" data-group="chat" id="lb-gchat">По темам</button><button type="button" role="radio" aria-checked="false" data-group="day" id="lb-gday">По дням</button></div>
        <label class="viz-range"><span>Вращение</span><output id="o-rotation"></output><input type="range" min="0" max="1" step="0.05" data-opt="rotation" /></label>
        <label class="viz-range"><span>Сила связей</span><output id="o-force"></output><input type="range" min="0" max="1" step="0.05" data-opt="force" /></label>
        <label class="viz-range"><span>Размер узлов</span><output id="o-size"></output><input type="range" min="0.5" max="2" step="0.1" data-opt="size" /></label>
        <label class="viz-check"><input type="checkbox" data-opt="labels" /> Подписи сообщений (при приближении)</label>
        <label class="viz-check"><input type="checkbox" data-opt="links" /> <span id="lb-links">Связи между воспоминаниями</span></label>
        <div class="viz-row"><button class="btn small" type="button" data-act="expand">Развернуть всё</button><button class="btn small" type="button" data-act="collapse">Свернуть всё</button><button class="btn small" type="button" data-act="center">Центрировать</button></div>
        <h3>Тема карты</h3><div class="viz-themes" role="radiogroup" aria-label="Тема карты">${MAP_THEMES.map((t) => `<button type="button" role="radio" aria-checked="false" data-maptheme="${t.id}"><span class="sw">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${t.label}</b><em>Используется</em></button>`).join("")}</div>
        <div class="viz-row"><button class="btn small primary" type="button" data-act="png">Скачать PNG</button><button class="btn small" type="button" data-act="reset-map">По умолчанию</button></div>
      </aside></div>
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
  let map = loadMap();
  const graph: GraphHandle = mountGraph($<HTMLCanvasElement>("graph"), $("graph-tip"), { onPick: (id) => void open(id), onMore: (id) => moreOf(id - AREA_OFF), onCollapse: (ids) => { map = { ...map, collapsed: ids }; saveMap(map); },
    onSystem: (id) => { if (id.startsWith("chat:")) { void open(Number(id.slice(5))); graph.focus("chat:" + id.slice(5)); return; } if (id === "key" || id === "model" || id === "db") window.dispatchEvent(new CustomEvent("yaeori:goto", { detail: { page: "settings", section: id === "key" ? "conn" : id === "model" ? "model" : "memory" } })); else if (id === "palette") { panel.hidden = false; $("viz-toggle").setAttribute("aria-expanded", "true"); } },
    onShowEnd: () => { $("viz-show").setAttribute("aria-pressed", "false"); $("viz-show").textContent = "▷ Показ"; } }, map);
  const panel = $("viz-panel");
  let lastBrain: GraphData | null = null;
  let vec: VecInfo | null = null, building = false;
  const list = mountList($("viz-list"), { more: (id) => moreOf(id), openChat: (id) => void open(id), focus: (t) => graph.focus(t), pin: (t) => graph.pin(t), kinds: (k) => graph.setLinkKinds(k),
    edit: (id, p) => updateMemory(id, p).then(() => refreshGraph()), forget: (id) => forgetMemory(id).then(() => refreshGraph()),
    review: () => reviewMemories(), merge: (k, d, hs) => mergeMemories(k, d, hs).then(() => refreshGraph()),
    compress: (ids, text, topic) => compressMemories(ids, text, topic).then(() => refreshGraph()),
    inactive: () => getInactive().then((r) => r.items), entities: () => getEntities().then((r) => r.items), restore: (id) => restoreMemory(id).then(() => refreshGraph()),
    build: () => { building = true; syncList(); void buildVectors().then((v) => { vec = v; }, () => {}).finally(() => { building = false; syncList(); void refreshGraph(); }); },
    setEmbedModel: (m) => void saveConn({ embedModel: m }).then(() => { vec = null; return getVectors(); }).then((v) => { vec = v; }, () => {}).finally(syncList) });
  let vecTimer = 0;
  const pollVec = async () => { // пока векторы досчитываются сами, панель обновляется
    try { vec = await getVectors(); syncList(); } catch { return; }
    if (!dead && vec && vec.ok !== false && vec.indexed < vec.total && !vecTimer) vecTimer = window.setTimeout(() => { vecTimer = 0; void pollVec(); }, 4000);
  };
  const syncList = () => list.update({ chats, brain: lastBrain, current, vec, building });
  $("viz-list-toggle").addEventListener("click", (e) => { const l = $("viz-list"); l.hidden = !l.hidden; (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!l.hidden)); });
  const syncPanel = () => {
    document.querySelectorAll<HTMLElement>("[data-layout]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.layout === map.layout)));
    document.querySelectorAll<HTMLElement>("[data-maptheme]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.maptheme === map.theme)));
    for (const k of ["rotation", "force", "size"] as const) { (panel.querySelector(`[data-opt="${k}"]`) as HTMLInputElement).value = String(map[k]); $("o-" + k).textContent = k === "size" ? map[k].toFixed(1) : map[k].toFixed(2); }
    document.querySelectorAll<HTMLElement>("[data-group]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.group === map.group)));
    (panel.querySelector('[data-opt="labels"]') as HTMLInputElement).checked = map.labels;
    (panel.querySelector('[data-opt="links"]') as HTMLInputElement).checked = map.links;
  };
  const apply = (p: Partial<MapOptions>) => { map = { ...map, ...p }; graph.setOptions(p); saveMap(map); syncPanel(); };
  syncPanel();
  $("viz-show").addEventListener("click", (e) => { const b = e.currentTarget as HTMLElement, on = graph.show(b.getAttribute("aria-pressed") !== "true"); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "■ Стоп показа" : "▷ Показ"; });
  $("viz-toggle").addEventListener("click", (e) => { const t = e.currentTarget as HTMLElement; panel.hidden = !panel.hidden; t.setAttribute("aria-expanded", String(!panel.hidden)); });
  $<HTMLInputElement>("viz-search").addEventListener("input", (e) => graph.search((e.target as HTMLInputElement).value));
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement, k = t.dataset.opt as keyof MapOptions | undefined; if (!k) return;
    if (k === "labels") apply({ labels: t.checked }); else if (k === "links") apply({ links: t.checked }); else apply({ [k]: Number(t.value) } as Partial<MapOptions>);
  });
  panel.addEventListener("click", async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-layout],[data-maptheme],[data-group],[data-act]"); if (!t) return;
    if (t.dataset.layout) apply({ layout: t.dataset.layout as Layout });
    else if (t.dataset.group) { apply({ group: t.dataset.group as Grouping, collapsed: [] }); }
    else if (t.dataset.maptheme) apply({ theme: t.dataset.maptheme as MapTheme });
    else switch (t.dataset.act) {
      case "expand": graph.expandAll(); map = graph.options(); saveMap(map); break;
      case "collapse": graph.collapseAll(); map = graph.options(); saveMap(map); break;
      case "center": graph.recenter(); break;
      case "reset-map": apply({ ...DEFAULT_MAP }); graph.recenter(); break;
      case "png": { const b = await graph.png(); if (b) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "yaeori-karta.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } break; }
    }
  });

  const errorHtml = (e: { error?: string; hint?: string; code?: number | string; detail?: string }) => {
    const fixKey = [401, 403, "NO_KEY"].includes(e.code as never), fixModel = [404, 409, 422, "NO_MODEL"].includes(e.code as never);
    return `<strong>${esc(e.error ?? "Ошибка")}</strong>${e.hint ? `<span class="err-hint">${esc(e.hint)}</span>` : ""}${e.detail ? `<small class="err-detail">Ответ сервиса: ${esc(e.detail)}</small>` : ""}`
      + (fixKey || fixModel ? `<button class="btn small err-go" data-goto="${fixKey ? "conn" : "model"}">Открыть «${fixKey ? "Подключение" : "Модель"}»</button>` : "");
  };
  thread.addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-goto]"); if (b) window.dispatchEvent(new CustomEvent("yaeori:goto", { detail: { page: "settings", section: b.dataset.goto } })); });
  const bubble = (role: "user" | "assistant" | "error", html: string) => {
    const d = document.createElement("div"); d.className = "msg " + role; d.innerHTML = html; thread.appendChild(d);
    thread.scrollTop = thread.scrollHeight; return d;
  };
  const hello = () => { thread.innerHTML = ""; bubble("assistant", "Здравствуйте! Я Yaeori. О чём поговорим?"); };

  $("viz-legend").innerHTML = `<span>цвет — тема</span><span><i class="dot you"></i> свежая</span><span><i class="dot long"></i> долгая</span><span><i class="dot fade"></i> забывается</span><span><i class="dot bot sq"></i> беседа</span>`;
  $("lb-gchat").textContent = "По темам и чатам"; $("lb-gday").textContent = "По дням"; $("lb-links").textContent = "Связи между воспоминаниями";
  const mergeMap = (b: GraphData, c: GraphData): GraphData => ({
    stats: b.stats,
    chats: [...c.chats, ...b.chats.map((a) => ({ ...a, id: AREA_OFF + a.id }))],
    messages: [...c.messages, ...b.messages.map((m) => ({ ...m, id: NEURON_OFF + m.id, chatId: AREA_OFF + m.chatId }))],
    links: [...c.links, ...b.links.map((l) => ({ ...l, a: NEURON_OFF + l.a, b: NEURON_OFF + l.b }))],
  });
  /** Крупная тема на карте показана не целиком: по запросу подгружаем её остальные воспоминания. */
  const openTopics = new Set<string>();
  const moreOf = (areaId: number) => { const t = lastBrain?.chats.find((c) => c.id === areaId)?.title; if (!t || openTopics.has(t)) return; openTopics.add(t); void refreshGraph(); };
  async function refreshGraph() {
    try {
      const [br, ch] = await Promise.all([getBrain([...openTopics]).catch(() => null), getGraph()]); if (dead) return;
      const g = br ? mergeMap(br, ch) : ch, nn = br?.messages.length ?? 0;
      graph.update(g); void getEntities().then((r) => { if (!dead) graph.setEntities(r.items); }, () => { /* без сущностей карта работает */ }); graph.select(current || null); lastBrain = br; syncList(); void pollVec();
      const st = g.stats, chatMsgs = ch.messages.length;
      stats.innerHTML = `<i class="live"></i><span${st ? ` title="${st.next ? `До следующего уровня: ${st.next - st.memories}` : "Высший уровень"}"` : ""}>${st?.memories ?? nn} воспом. · ${st?.topics ?? 0} тем · ${chatMsgs} сообщ. · ${ch.chats.length} чатов${st ? ` · «${esc(st.levelName)}»` : ""}</span>`;
      empty.hidden = g.messages.length > 0;
      $("viz-empty-text").textContent = "Пока пусто. Карта растёт, пока вы общаетесь: Yaeori запоминает факты и копит беседы.";
      $("viz-scan").hidden = nn > 0 || chats.length === 0;
      const c = await getConn().catch(() => null); if (dead) return;
      const theme = MAP_THEMES.find((t) => t.id === map.theme)?.label ?? "";
      const sys: SysItem[] = [
        { id: "key", label: "Ключ Cloud.ru", detail: c ? (c.keySet ? "задан" : "не задан") : "нет связи", ok: !!c?.keySet, icon: "key" },
        { id: "model", label: "Модель", detail: c?.model || "не выбрана", ok: !!c?.model, icon: "spark" },
        { id: "db", label: "Память", detail: c?.memory === false ? "выключена" : `${nn} воспомин., ${chatMsgs} сообщ.`, ok: c?.memory !== false, icon: "db" },
        { id: "chats", label: "Чаты", detail: String(chats.length), ok: true, icon: "chat" },
        { id: "palette", label: "Тема карты", detail: theme, ok: true, icon: "palette" },
        ...chats.slice(0, 60).map((x): SysItem => ({ id: "chat:" + x.id, label: x.title, detail: `${x.count} сообщ.`, ok: true, icon: "chat", group: "chat", chatId: x.id, on: x.id === current }))];
      graph.setSystem(sys);
    } catch { /* карта необязательна */ }
  }
  $("viz-scan").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("viz-scan"), st = $("viz-scan-status"); btn.disabled = true; st.textContent = "Читаю беседы…";
    try { const r = await scanMemories(); st.textContent = r.ok ? (r.empty ? "Бесед для чтения пока нет." : r.added ? `Вспомнила: ${r.added}` : "Новых фактов не нашла.") : `${r.error ?? "Не получилось"}. ${r.hint ?? ""}`; await refreshGraph(); }
    catch (e) { st.textContent = (e as Error).message; }
    btn.disabled = false;
  });
  async function refreshChats() {
    chats = await listChats(); if (dead) return; syncList();
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
    // Плавный вывод: на экран идёт не весь накопленный текст сразу, а растущий «хвост» — скорость зависит от отставания.
    let acc = "", shown = 0, frame = 0, failed = false;
    const paint = () => {
      frame = 0;
      const back = acc.length - shown; if (back > 0) shown += Math.min(back, Math.max(1, Math.ceil(back / 14)));
      out.innerHTML = renderText(acc.slice(0, shown), shown < acc.length || !finished); thread.scrollTop = thread.scrollHeight;
      if (shown < acc.length) frame = requestAnimationFrame(paint);
    };
    let finished = false;
    const my = new AbortController(); ctrl = my; setBusy(true);
    let answered = false; graph.flow(["chat:" + id, "core"], "user"); graph.think(true);
    try {
      await sendMessage(id, text, (e) => {
        if (e.user) void refreshGraph();
        if (e.recalled?.length) {
          e.recalled.slice(0, 8).forEach((m, i) => graph.flow(["mem:" + m.id, "core", "chat:" + id], m.hop ? "accent" : "bot", 200 + i * 150));
          const n = document.createElement("div"); n.className = "msg notice"; const nSess = e.recalled.filter((m) => m.session).length, shown = e.recalled.slice(0, 3).map((m) => m.text.replace(/\.$/, "")).join(" · ");
          n.textContent = `Вспомнила (${e.recalled.length}${nSess ? `, из этой беседы ${nSess}` : ""}): ${shown.length > 140 ? shown.slice(0, 139) + "…" : shown}`; thread.insertBefore(n, out);
        }
        if (e.delta) { if (!answered) { answered = true; graph.think(false); graph.flow(["core", "chat:" + id], "bot"); } acc += e.delta; if (!frame) frame = requestAnimationFrame(paint); }
        if (e.notice) { const n = document.createElement("div"); n.className = "msg notice"; n.textContent = e.notice; thread.insertBefore(n, out); }
        if (e.error) { graph.think(false); failed = true; out.className = "msg error"; out.innerHTML = errorHtml(e); }
        if (e.done) { finished = true; if (frame) { cancelAnimationFrame(frame); frame = 0; } shown = acc.length; paint(); if (ctrl === my) setBusy(false); }
        if (e.brain) {
          const b = e.brain, n = document.createElement("div"); n.className = "msg notice";
          if (b.error) n.textContent = `Память не обновилась: ${b.error.error ?? "ошибка"}`; else if (b.added || b.strengthened) n.textContent = `Мозг: запомнила ${b.added ?? 0}, закрепила ${b.strengthened ?? 0}`;
          if (n.textContent) { thread.appendChild(n); thread.scrollTop = thread.scrollHeight; }
          void refreshGraph().then(() => {
            (b.addedIds ?? []).forEach((x, i) => graph.flow(["chat:" + id, "core", "mem:" + x], "mint", i * 180));
            if (b.strengthenedIds?.length) graph.flash(b.strengthenedIds.map((x) => "mem:" + x), "gold");
          });
        }
      }, my.signal);
    } catch (e) { if ((e as Error).name !== "AbortError") { failed = true; out.className = "msg error"; out.innerHTML = errorHtml({ error: (e as Error).message }); } }
    graph.think(false); if (frame) cancelAnimationFrame(frame);
    finished = true; shown = acc.length;
    if (!failed) paint(); else if (!acc) { /* сообщение об ошибке уже в пузыре */ }
    if (ctrl === my) { ctrl = null; if (!dead) setBusy(false); } if (!dead) { void refreshChats(); void refreshGraph(); }
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

  return () => { dead = true; clearTimeout(vecTimer); ctrl?.abort(); graph.destroy(); };
}
