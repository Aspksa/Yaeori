import "./style.css";
import { ACCENTS, DEFAULT_CUSTOM_ACCENT, applyAccent, applyTheme, isHexColor, swatchColor, type AccentId, type Theme } from "./accents";

interface Prefs { theme: Theme; accent: AccentId; custom: string }
const KEY = "yaeori:prefs:v1";
const THEMES: [Theme, string, string][] = [["auto", "Как в системе", "Подстраивается под ОС"], ["light", "Светлая", "Для яркого освещения"], ["dark", "Тёмная", "Графитовая, по умолчанию ночью"]];

function load(): Prefs {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    const theme = THEMES.some(([t]) => t === o?.theme) ? o!.theme! : "auto";
    const accent = [...ACCENTS.map((a) => a.id), "custom"].includes(o?.accent as AccentId) ? o!.accent! : "gold";
    return { theme, accent, custom: isHexColor(o?.custom) ? o!.custom : DEFAULT_CUSTOM_ACCENT };
  } catch { return { theme: "auto", accent: "gold", custom: DEFAULT_CUSTOM_ACCENT }; }
}
let prefs = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* хранилище недоступно */ } };
const paint = () => { applyTheme(prefs.theme); applyAccent(prefs.accent, prefs.custom); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { paint(); if (page === "settings") render(); });
paint();

type PageId = "home" | "settings";
let page: PageId = location.hash === "#settings" ? "settings" : "home";
let menuOpen = false;

const svg = (d: string) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};
const NAV: [PageId, string][] = [["home", "Главная"], ["settings", "Настройки"]];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function homeView() {
  return `<header class="pg-head"><h1>Главная</h1><p class="muted">Здесь будет содержимое Yaeori.</p></header>
    <section class="card hero"><h2>Добро пожаловать</h2><p class="muted">Дизайн взят у JUUNIBI: графитовая тема и один акцентный цвет. Круглой кнопки-аватара нет.</p>
    <button class="btn primary" data-go="settings">Открыть настройки</button></section>`;
}
function settingsView() {
  const themes = THEMES.map(([id, label, hint]) =>
    `<button class="theme-card" role="radio" aria-checked="${prefs.theme === id}" data-theme-id="${id}"><strong>${label}</strong><small>${hint}</small></button>`).join("");
  const sw = ACCENTS.map((a) =>
    `<button class="swatch" role="radio" aria-checked="${prefs.accent === a.id}" aria-label="${esc(a.label)}" title="${esc(a.label)}" data-accent="${a.id}" style="background:${swatchColor(a)}"></button>`).join("");
  return `<header class="pg-head"><h1>Настройки</h1><p class="muted">Внешний вид сохраняется в браузере.</p></header>
    <section class="card"><h2>Тема</h2><p class="muted">Светлая, тёмная или как в системе.</p><div class="theme-cards" role="radiogroup" aria-label="Тема">${themes}</div></section>
    <section class="card"><h2>Акцентный цвет</h2><p class="muted">Кнопки, выделения и свечение.</p>
      <div class="swatches" role="radiogroup" aria-label="Акцентный цвет">${sw}
        <label class="swatch-custom" role="radio" aria-checked="${prefs.accent === "custom"}" title="Свой цвет"><input type="color" aria-label="Свой цвет" value="${prefs.custom}" data-custom /></label></div></section>`;
}

function render() {
  const nav = NAV.map(([id, label]) => `<button class="nav-item" data-nav="${id}"${page === id ? ' aria-current="page"' : ""}>${ICONS[id]}<span>${label}</span></button>`).join("");
  document.getElementById("app")!.innerHTML = `<div class="shell${menuOpen ? " open" : ""}">
    <div class="topbar"><button class="btn" data-menu aria-label="Меню">${ICONS.menu}</button><strong>Yaeori</strong></div>
    <aside class="side" aria-label="Меню"><div class="brand"><i></i>Yaeori</div>${nav}<div class="grow"></div><div class="side-foot">v0.1.0</div></aside>
    <main class="main">${page === "home" ? homeView() : settingsView()}</main></div>`;
}

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-nav],[data-go],[data-menu],[data-theme-id],[data-accent]");
  if (!t) { if (menuOpen && !(e.target as HTMLElement).closest(".side")) { menuOpen = false; render(); } return; }
  const go = t.dataset.nav ?? t.dataset.go;
  if (go) { page = go as PageId; menuOpen = false; history.replaceState(null, "", page === "home" ? "#" : "#" + page); }
  else if (t.dataset.menu !== undefined) menuOpen = !menuOpen;
  else if (t.dataset.themeId) { prefs = { ...prefs, theme: t.dataset.themeId as Theme }; save(); paint(); }
  else if (t.dataset.accent) { prefs = { ...prefs, accent: t.dataset.accent as AccentId }; save(); paint(); }
  render();
});
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.custom === undefined) return;
  prefs = { ...prefs, accent: "custom", custom: t.value }; save(); paint();
});
document.addEventListener("change", (e) => { if ((e.target as HTMLElement).matches("[data-custom]")) render(); });
render();
