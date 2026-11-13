import { ACCENTS, swatchColor, type AccentId, type Theme } from "./accents";
import { checkConn, getConn, getGuide, saveConn, testModel, type Conn, type Explained, type Guide, type TestResult } from "./api";
import { DEFAULT_PREFS, clean, type Density, type Prefs, type Radius, type TextSize } from "./prefs";
import pkg from "../package.json";

interface Ctx { prefs: () => Prefs; set: (patch: Partial<Prefs>) => void; rerender: () => void }
interface Section { id: string; title: string; lead: string; keywords: string }

export const SECTIONS: Section[] = [
  { id: "conn", title: "Подключение", lead: "Ключ Cloud.ru хранится только на этом компьютере.", keywords: "ключ api cloud.ru соединение подключить адрес" },
  { id: "model", title: "Модель", lead: "Основная и запасная модель нейросети.", keywords: "модель запасная нейросеть" },
  { id: "look", title: "Внешний вид", lead: "Тема, акцент, размер текста, плотность и скругления.", keywords: "тема тёмная светлая цвет акцент скругление размер текста плотность шрифт" },
  { id: "data", title: "Данные", lead: "Резервная копия и сброс настроек.", keywords: "экспорт импорт резервная копия сброс по умолчанию удалить" },
  { id: "about", title: "О программе", lead: "Версия и горячие клавиши.", keywords: "версия горячие клавиши сочетания" },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const THEMES: [Theme, string, string][] = [["auto", "Как в системе", "Подстраивается под ОС"], ["light", "Светлая", "Для яркого освещения"], ["dark", "Тёмная", "Графитовая"]];
const SIZES: [TextSize, string][] = [["small", "Мелкий"], ["normal", "Обычный"], ["large", "Крупный"]];
const DENS: [Density, string][] = [["comfortable", "Свободно"], ["compact", "Компактно"]];
const RADII: [Radius, string][] = [["sharp", "Острые"], ["normal", "Обычные"], ["round", "Крупные"]];

const seg = <T extends string>(name: string, label: string, opts: [T, string][], value: T) =>
  `<div class="set-row"><strong>${label}</strong><div class="segmented" role="radiogroup" aria-label="${label}">${opts.map(([v, t]) =>
    `<button type="button" role="radio" aria-checked="${v === value}" data-seg="${name}" data-v="${v}">${t}</button>`).join("")}</div></div>`;

// Черновики полей переживают перерисовку, пока их не сохранили.
const drafts = new Map<string, string>();
let conn: Conn | null = null, connError = "", status = "", models: string[] = [], busy = false;
let mq = "", problem: Explained | null = null, guide: Guide | null = null, autoChecked = false, listing = false;
const tests: Record<string, TestResult | "wait"> = {};

function card(s: Section, collapsed: boolean, body: string) {
  return `<section class="card set-card${collapsed ? " collapsed" : ""}" id="set-${s.id}" data-title="${esc(s.title)}" data-search="${esc((s.title + " " + s.keywords + " " + s.lead).toLowerCase())}">
    <div class="set-card-head"><button class="set-collapse" data-collapse="${s.id}" aria-expanded="${!collapsed}" aria-controls="set-body-${s.id}" aria-label="${collapsed ? "Развернуть" : "Свернуть"}: ${esc(s.title)}"><span aria-hidden="true">▾</span></button>
      <div class="grow"><h2>${esc(s.title)}</h2><p class="muted">${esc(s.lead)}</p></div>
      ${s.id === "about" ? "" : `<button class="btn small" data-reset="${s.id}" title="Вернуть раздел «${esc(s.title)}» к исходным настройкам">По умолчанию</button>`}</div>
    <div class="set-card-body" id="set-body-${s.id}">${body}</div></section>`;
}
const field = (id: string, label: string, value: string, o: { ph?: string; list?: string; type?: string } = {}) =>
  `<label class="field"><span>${label}</span><input id="${id}" type="${o.type ?? "text"}" value="${esc(drafts.get(id) ?? value)}" placeholder="${esc(o.ph ?? "")}" spellcheck="false" autocomplete="off"${o.list ? ` list="${o.list}"` : ""} data-draft></label>`;

function connBody() {
  if (!conn) return `<p class="muted">${connError ? esc(connError) : "Загрузка…"}</p>${connError ? `<button class="btn" data-act="retry">Повторить</button>` : ""}`;
  const pill = `<span class="pill ${conn.keySet ? "ok" : "warn"}">${conn.keySet ? "Ключ задан" : "Ключ не задан"}</span>`;
  return `<div class="row">${pill}${status ? `<span class="muted" role="status">${esc(status)}</span>` : ""}</div>
    <label class="field"><span>API-ключ</span><span class="row nowrap"><input id="set-key" type="password" name="yaeori-key" autocomplete="new-password" spellcheck="false" placeholder="${conn.keySet ? "Вставьте новый ключ, чтобы заменить" : "Вставьте ключ из консоли Cloud.ru"}" value="${esc(drafts.get("set-key") ?? "")}" data-draft />
      <button class="btn" type="button" data-act="eye" aria-label="Показать ключ" aria-pressed="false">Показать</button></span></label>
    ${field("set-base", "Адрес API", conn.baseUrl, { ph: "https://foundation-models.api.cloud.ru/v1" })}${problemHtml()}
    <div class="row"><button class="btn primary" data-act="save-conn"${busy ? " disabled" : ""}>Сохранить</button>
      <button class="btn" data-act="check"${busy || !conn.keySet ? " disabled" : ""}>Проверить</button>
      ${conn.keySet ? `<button class="btn danger" data-act="del-key"${busy ? " disabled" : ""}>Удалить ключ</button>` : ""}</div>`;
}
const problemHtml = () => !problem ? "" : `<div class="set-err" role="alert"><strong>${esc(problem.error ?? "Ошибка")}</strong>${problem.hint ? `<p>${esc(problem.hint)}</p>` : ""}${problem.detail ? `<small>Ответ сервиса: ${esc(problem.detail)}</small>` : ""}</div>`;
const vendor = (m: string) => (m.includes("/") ? m.split("/")[0]! : "прочие");
function testHtml(name: string) {
  const t = tests[name]; if (!name || !t) return "";
  if (t === "wait") return `<span class="muted">Проверяю…</span>`;
  return t.ok ? `<span class="pill ok">Отвечает за ${((t.ms ?? 0) / 1000).toFixed(1)} с</span>` : `<div class="set-err"><strong>${esc(t.error ?? "Не отвечает")}</strong>${t.hint ? `<p>${esc(t.hint)}</p>` : ""}${t.detail ? `<small>Ответ сервиса: ${esc(t.detail)}</small>` : ""}</div>`;
}
function slot(label: string, name: string, kind: "main" | "fallback") {
  const known = models.length > 0 && name && !models.includes(name);
  return `<div class="mdl-slot"><div class="mdl-slot-head"><span class="muted">${label}</span>${name ? `<code>${esc(name)}</code>` : `<em class="muted">${kind === "main" ? "не выбрана" : "не задана"}</em>`}
    ${known ? `<span class="pill warn" title="Такого названия нет в списке Cloud.ru">нет в списке</span>` : ""}
    ${name ? `<button class="btn small" data-act="test" data-m="${esc(name)}"${tests[name] === "wait" ? " disabled" : ""}>Проверить</button><button class="btn small" data-pick="${kind}" data-m="${esc(name)}" aria-label="Убрать: ${label}">Убрать</button>` : ""}</div>${testHtml(name)}</div>`;
}
function modelTop() {
  if (!conn) return "";
  return `${slot("Основная", conn.model, "main")}${slot("Запасная", conn.fallbackModel, "fallback")}
    <p class="muted mdl-note">Если основная не ответит, чат сам попробует запасную.</p>${problemHtml()}
    <div class="row"><button class="btn" data-act="refresh-models"${listing || !conn.keySet ? " disabled" : ""}>${listing ? "Загружаю…" : "Обновить список"}</button>
      <span class="muted" role="status">${models.length ? `Моделей: ${models.length}` : conn.keySet ? "" : "Сначала сохраните ключ в разделе «Подключение»."}${status ? " " + esc(status) : ""}</span></div>`;
}
function modelListHtml() {
  if (!conn) return "";
  if (!models.length) return `<p class="muted">${listing ? "Загружаю список…" : "Список моделей пуст."}</p>`;
  const q = mq.trim().toLowerCase(), list = models.filter((m) => !q || m.toLowerCase().includes(q));
  if (!list.length) return `<p class="muted">Ничего не найдено. Название можно ввести вручную ниже.</p>`;
  const groups = new Map<string, string[]>(); for (const m of list) { const v = vendor(m); groups.set(v, [...(groups.get(v) ?? []), m]); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([v, ms]) => `<div class="mdl-group"><h4>${esc(v)} <small>${ms.length}</small></h4>${ms.map((m) => {
    const main = m === conn!.model, fb = m === conn!.fallbackModel;
    return `<div class="mdl-row${main ? " is-main" : ""}"><button class="mdl-name" data-pick="main" data-m="${esc(m)}" title="Сделать основной">${esc(m.includes("/") ? m.slice(m.indexOf("/") + 1) : m)}</button>
      <button class="chip${main ? " on" : ""}" data-pick="main" data-m="${esc(m)}" aria-pressed="${main}">Основная</button><button class="chip${fb ? " on" : ""}" data-pick="fallback" data-m="${esc(m)}" aria-pressed="${fb}">Запасная</button></div>`;
  }).join("")}</div>`).join("");
}
function modelBody() {
  if (!conn) return `<p class="muted">Загрузка…</p>`;
  const rows = guide ? [...guide.http, ...guide.net, ...guide.other].map((g) => `<tr><td><code>${esc(String(g.code))}</code></td><td><strong>${esc(g.title)}</strong><br><span class="muted">${esc(g.hint)}</span></td></tr>`).join("") : "";
  return `<div id="model-top">${modelTop()}</div>
    <label class="field"><span>Поиск по списку</span><input id="set-mq" type="search" value="${esc(mq)}" placeholder="Например: qwen, llama, gpt…" spellcheck="false" autocomplete="off"></label>
    <div id="model-list" class="mdl-list">${modelListHtml()}</div>
    <details class="mdl-manual"><summary>Указать название вручную</summary>
      ${field("set-model", "Основная модель", conn.model, { ph: "Название из консоли Cloud.ru" })}${field("set-fallback", "Запасная модель", conn.fallbackModel, { ph: "Не задана" })}
      <div class="row"><button class="btn primary" data-act="save-model"${busy ? " disabled" : ""}>Сохранить</button></div></details>
    ${rows ? `<details class="mdl-manual"><summary>Что значат ошибки Cloud.ru</summary><table class="err-table"><tbody>${rows}</tbody></table></details>` : ""}`;
}
const refreshModels = () => { const t = document.getElementById("model-top"), l = document.getElementById("model-list"); if (t) t.innerHTML = modelTop(); if (l) l.innerHTML = modelListHtml(); };
async function loadModels(ctx: Ctx | null, silent: boolean) {
  listing = true; refreshModels();
  try { const r = await checkConn(); if (r.ok) { models = r.models ?? []; problem = null; } else problem = r; if (!silent && r.ok) status = ""; } catch (e) { problem = { error: (e as Error).message }; }
  listing = false; refreshModels(); if (ctx && !document.getElementById("model-top")) ctx.rerender();
}
function lookBody(p: Prefs) {
  const themes = THEMES.map(([id, l, h]) => `<button class="theme-card" role="radio" aria-checked="${p.theme === id}" data-theme-id="${id}"><strong>${l}</strong><small>${h}</small></button>`).join("");
  const sw = ACCENTS.map((a) => `<button class="swatch" role="radio" aria-checked="${p.accent === a.id}" aria-label="${esc(a.label)}" title="${esc(a.label)}" data-accent="${a.id}" style="background:${swatchColor(a)}"></button>`).join("");
  return `<div class="set-row"><strong>Тема</strong><div class="theme-cards" role="radiogroup" aria-label="Тема">${themes}</div></div>
    <div class="set-row"><strong>Акцентный цвет</strong><div class="swatches" role="radiogroup" aria-label="Акцентный цвет">${sw}
      <label class="swatch-custom" role="radio" aria-checked="${p.accent === "custom"}" title="Свой цвет"><input type="color" aria-label="Свой цвет" value="${p.custom}" data-custom /></label></div></div>
    ${seg("textSize", "Размер текста", SIZES, p.textSize)}${seg("density", "Плотность", DENS, p.density)}${seg("radius", "Скругления", RADII, p.radius)}`;
}
const dataBody = () => `<div class="row"><button class="btn" data-act="export">Сохранить настройки в файл</button><button class="btn" data-act="import">Загрузить из файла</button>
  <input type="file" accept="application/json,.json" hidden id="set-import" /></div>
  <p class="muted">Файл содержит только внешний вид. Ключ Cloud.ru в него не попадает.</p>
  <div class="row"><button class="btn danger" data-act="reset-all">Сбросить внешний вид</button></div>`;
const aboutBody = () => `<div class="set-row"><strong>Версия</strong><code>${esc(pkg.version)}</code></div>
  <div class="set-row"><strong>Горячие клавиши</strong><ul class="keys"><li><kbd>Alt</kbd>+<kbd>1</kbd> Главная</li><li><kbd>Alt</kbd>+<kbd>2</kbd> Настройки</li><li><kbd>/</kbd> поиск по настройкам</li></ul></div>`;

export function settingsView(p: Prefs) {
  const body: Record<string, string> = { conn: connBody(), model: modelBody(), look: lookBody(p), data: dataBody(), about: aboutBody() };
  const toc = SECTIONS.map((s) => `<button class="chip" data-toc="${s.id}">${esc(s.title)}</button>`).join("");
  return `<header class="pg-head"><h1>Настройки</h1><p class="muted">Внешний вид сохраняется в браузере, ключ — на этом компьютере.</p></header>
    <div class="set-tools"><input id="set-search" type="search" placeholder="Найти настройку…  ( / )" autocomplete="off" spellcheck="false" aria-label="Поиск по настройкам" />
      <button class="btn small" data-act="toggle-all">${p.collapsed.length >= SECTIONS.length ? "Развернуть все" : "Свернуть все"}</button></div>
    <nav class="set-toc" aria-label="Разделы настроек">${toc}</nav><p id="set-empty" class="muted" hidden>Ничего не найдено.</p>
    ${SECTIONS.map((s) => card(s, p.collapsed.includes(s.id), body[s.id]!)).join("")}`;
}

export function loadConn(ctx: Ctx) {
  getConn().then((c) => { conn = c; connError = ""; }, (e: Error) => { connError = "Не удалось связаться с сервером: " + e.message; }).finally(() => {
    ctx.rerender();
    if (!guide) getGuide().then((g) => { guide = g; ctx.rerender(); }, () => {});
    if (conn?.keySet && !autoChecked) { autoChecked = true; void loadModels(ctx, true); }
  });
}
const filter = (q: string) => {
  const needle = q.trim().toLowerCase(); let n = 0;
  document.querySelectorAll<HTMLElement>(".set-card").forEach((c) => { const hit = !needle || c.dataset.search!.includes(needle); c.hidden = !hit; if (hit) n++; });
  document.getElementById("set-empty")!.hidden = n > 0;
};
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
const download = (name: string, data: unknown) => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
async function run(ctx: Ctx, job: () => Promise<string>) {
  busy = true; status = ""; ctx.rerender();
  try { status = await job(); } catch (e) { status = (e as Error).message; }
  busy = false; ctx.rerender();
}

export function bindSettings(ctx: Ctx) {
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "set-search") { filter(t.value); return; }
    if (t.id === "set-mq") { mq = t.value; const l = document.getElementById("model-list"); if (l) l.innerHTML = modelListHtml(); return; }
    if (t.dataset.custom !== undefined) { ctx.set({ accent: "custom", custom: t.value }); return; }
    if (t.dataset.draft !== undefined) drafts.set(t.id, t.value);
  });
  document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.custom !== undefined) ctx.rerender();
    if (t.id === "set-import" && t.files?.[0]) {
      t.files[0].text().then((txt) => { ctx.set(clean(JSON.parse(txt))); status = "Настройки загружены"; ctx.rerender(); }, () => { status = "Файл не подошёл"; ctx.rerender(); });
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "/" && location.hash === "#settings" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) { e.preventDefault(); document.getElementById("set-search")?.focus(); }
  });
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-seg],[data-theme-id],[data-accent],[data-collapse],[data-toc],[data-reset],[data-act],[data-pick]");
    if (!t) return;
    const p = ctx.prefs();
    if (t.dataset.pick) {
      const m = t.dataset.m!, k = t.dataset.pick === "main" ? "model" : "fallbackModel", on = conn?.[k] === m;
      saveConn({ [k]: on || t.textContent === "Убрать" ? "" : m }).then((c) => { conn = c; status = ""; }, (e: Error) => { status = e.message; }).finally(refreshModels);
      return;
    }
    if (t.dataset.seg) { ctx.set({ [t.dataset.seg]: t.dataset.v } as Partial<Prefs>); ctx.rerender(); return; }
    if (t.dataset.themeId) { ctx.set({ theme: t.dataset.themeId as Theme }); ctx.rerender(); return; }
    if (t.dataset.accent) { ctx.set({ accent: t.dataset.accent as AccentId }); ctx.rerender(); return; }
    if (t.dataset.collapse) { const id = t.dataset.collapse; ctx.set({ collapsed: p.collapsed.includes(id) ? p.collapsed.filter((x) => x !== id) : [...p.collapsed, id] }); ctx.rerender(); return; }
    if (t.dataset.toc) { const id = t.dataset.toc; if (p.collapsed.includes(id)) { ctx.set({ collapsed: p.collapsed.filter((x) => x !== id) }); ctx.rerender(); } document.getElementById("set-" + id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" }); return; }
    if (t.dataset.reset) {
      const id = t.dataset.reset;
      if (id === "look") ctx.set({ theme: DEFAULT_PREFS.theme, accent: DEFAULT_PREFS.accent, custom: DEFAULT_PREFS.custom, textSize: DEFAULT_PREFS.textSize, density: DEFAULT_PREFS.density, radius: DEFAULT_PREFS.radius });
      if (id === "conn") { for (const k of ["set-key", "set-base"]) drafts.delete(k); void run(ctx, async () => { conn = await saveConn({ key: null, baseUrl: "" }); return "Подключение сброшено"; }); return; }
      if (id === "model") { for (const k of ["set-model", "set-fallback"]) drafts.delete(k); void run(ctx, async () => { conn = await saveConn({ model: "", fallbackModel: "" }); return "Модели сброшены"; }); return; }
      if (id === "data") { download("yaeori-settings.json", { ...p, collapsed: [] }); return; }
      ctx.rerender(); return;
    }
    switch (t.dataset.act) {
      case "retry": connError = ""; loadConn(ctx); break;
      case "eye": { const i = document.getElementById("set-key") as HTMLInputElement; const on = i.type === "password"; i.type = on ? "text" : "password"; t.textContent = on ? "Скрыть" : "Показать"; t.setAttribute("aria-pressed", String(on)); t.setAttribute("aria-label", on ? "Скрыть ключ" : "Показать ключ"); break; }
      case "save-conn": void run(ctx, async () => {
        const key = val("set-key").trim();
        conn = await saveConn({ ...(key ? { key } : {}), baseUrl: val("set-base") });
        drafts.delete("set-key"); drafts.delete("set-base"); problem = null; if (conn.keySet) { autoChecked = true; void loadModels(null, true); } return key ? "Сохранено" : "Адрес сохранён";
      }); break;
      case "del-key": if (confirm("Удалить сохранённый ключ?")) void run(ctx, async () => { conn = await saveConn({ key: null }); drafts.delete("set-key"); models = []; problem = null; autoChecked = false; return "Ключ удалён"; }); break;
      case "check": void run(ctx, async () => {
        const r = await checkConn();
        if (!r.ok) { problem = r; return ""; }
        problem = null; models = r.models ?? [];
        return r.modelFound === false ? "Ключ принят, но выбранной модели нет в списке" : `Ключ принят, моделей: ${models.length}`;
      }); break;
      case "refresh-models": void loadModels(ctx, false); break;
      case "test": { const m = t.dataset.m!; tests[m] = "wait"; refreshModels(); testModel(m).then((r) => { tests[m] = r; }, (e: Error) => { tests[m] = { ok: false, error: e.message }; }).finally(refreshModels); break; }
      case "save-model": void run(ctx, async () => { conn = await saveConn({ model: val("set-model"), fallbackModel: val("set-fallback") }); drafts.delete("set-model"); drafts.delete("set-fallback"); return "Сохранено"; }); break;
      case "toggle-all": ctx.set({ collapsed: p.collapsed.length >= SECTIONS.length ? [] : SECTIONS.map((s) => s.id) }); ctx.rerender(); break;
      case "export": download("yaeori-settings.json", { ...p, collapsed: [] }); break;
      case "import": document.getElementById("set-import")?.click(); break;
      case "reset-all": if (confirm("Вернуть внешний вид к исходному?")) { ctx.set({ ...DEFAULT_PREFS, collapsed: p.collapsed }); status = ""; ctx.rerender(); } break;
    }
  });
}
