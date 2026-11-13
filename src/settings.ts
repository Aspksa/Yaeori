import { ACCENTS, swatchColor, type AccentId, type Theme } from "./accents";
import { checkConn, getConn, saveConn, type Conn } from "./api";
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
    ${field("set-base", "Адрес API", conn.baseUrl, { ph: "https://foundation-models.api.cloud.ru/v1" })}
    <div class="row"><button class="btn primary" data-act="save-conn"${busy ? " disabled" : ""}>Сохранить</button>
      <button class="btn" data-act="check"${busy || !conn.keySet ? " disabled" : ""}>Проверить</button>
      ${conn.keySet ? `<button class="btn danger" data-act="del-key"${busy ? " disabled" : ""}>Удалить ключ</button>` : ""}</div>`;
}
function modelBody() {
  if (!conn) return `<p class="muted">Загрузка…</p>`;
  return `<datalist id="set-models">${models.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
    ${field("set-model", "Основная модель", conn.model, { list: "set-models", ph: "Название из консоли Cloud.ru" })}
    ${field("set-fallback", "Запасная модель", conn.fallbackModel, { list: "set-models", ph: "Не задана" })}
    <div class="row"><button class="btn primary" data-act="save-model"${busy ? " disabled" : ""}>Сохранить</button>
    ${models.length ? `<span class="muted">Доступно моделей: ${models.length}</span>` : `<span class="muted">Нажмите «Проверить» в разделе «Подключение», чтобы получить список моделей.</span>`}</div>`;
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
  getConn().then((c) => { conn = c; connError = ""; }, (e: Error) => { connError = "Не удалось связаться с сервером: " + e.message; }).finally(ctx.rerender);
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
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-seg],[data-theme-id],[data-accent],[data-collapse],[data-toc],[data-reset],[data-act]");
    if (!t) return;
    const p = ctx.prefs();
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
        drafts.delete("set-key"); drafts.delete("set-base"); return key ? "Сохранено" : "Адрес сохранён";
      }); break;
      case "del-key": if (confirm("Удалить сохранённый ключ?")) void run(ctx, async () => { conn = await saveConn({ key: null }); drafts.delete("set-key"); models = []; return "Ключ удалён"; }); break;
      case "check": void run(ctx, async () => {
        const r = await checkConn();
        if (!r.ok) return r.error ?? "Проверка не удалась";
        models = r.models ?? [];
        return r.modelFound === false ? "Ключ принят, но выбранной модели нет в списке" : `Ключ принят, моделей: ${models.length}`;
      }); break;
      case "save-model": void run(ctx, async () => { conn = await saveConn({ model: val("set-model"), fallbackModel: val("set-fallback") }); drafts.delete("set-model"); drafts.delete("set-fallback"); return "Сохранено"; }); break;
      case "toggle-all": ctx.set({ collapsed: p.collapsed.length >= SECTIONS.length ? [] : SECTIONS.map((s) => s.id) }); ctx.rerender(); break;
      case "export": download("yaeori-settings.json", { ...p, collapsed: [] }); break;
      case "import": document.getElementById("set-import")?.click(); break;
      case "reset-all": if (confirm("Вернуть внешний вид к исходному?")) { ctx.set({ ...DEFAULT_PREFS, collapsed: p.collapsed }); status = ""; ctx.rerender(); } break;
    }
  });
}
