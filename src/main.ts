import "./style.css";
import { clean, load, paint, save, type Prefs } from "./prefs";
import { homeView, mountHome } from "./chat";
import { bindSettings, loadConn, settingsView } from "./settings";

let prefs: Prefs = load();
const setPrefs = (patch: Partial<Prefs>) => { prefs = clean({ ...prefs, ...patch }); save(prefs); paint(prefs); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { paint(prefs); if (page === "settings") render(); });
paint(prefs);

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

let unmount: (() => void) | null = null;
function render() {
  unmount?.(); unmount = null;
  const nav = NAV.map(([id, label]) => `<button class="nav-item" data-nav="${id}"${page === id ? ' aria-current="page"' : ""}>${ICONS[id]}<span>${label}</span></button>`).join("");
  document.getElementById("app")!.innerHTML = `<div class="shell${menuOpen ? " open" : ""}">
    <div class="topbar"><button class="btn" data-menu aria-label="Меню">${ICONS.menu}</button><strong>Yaeori</strong></div>
    <aside class="side" aria-label="Меню"><div class="brand"><i></i>Yaeori</div>${nav}<div class="grow"></div><div class="side-foot">v0.1.0</div></aside>
    <main class="main${page === "home" ? " wide" : ""}">${page === "home" ? homeView() : settingsView(prefs)}</main></div>`;
  if (page === "home") unmount = mountHome();
}

const ctx = { prefs: () => prefs, set: setPrefs, rerender: render };
const go = (id: PageId) => { page = id; menuOpen = false; history.replaceState(null, "", id === "home" ? "#" : "#" + id); render(); if (id === "settings") loadConn(ctx); };
document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-nav],[data-go],[data-menu]");
  if (!t) { if (menuOpen && !(e.target as HTMLElement).closest(".side")) { menuOpen = false; document.querySelector(".shell")?.classList.remove("open"); } return; }
  const dest = t.dataset.nav ?? t.dataset.go;
  if (dest) go(dest as PageId); else { menuOpen = !menuOpen; document.querySelector(".shell")?.classList.toggle("open", menuOpen); }
});
document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "1") { e.preventDefault(); go("home"); } else if (e.key === "2") { e.preventDefault(); go("settings"); }
});
bindSettings({ ...ctx, rerender: () => { const y = scrollY; render(); scrollTo(0, y); } });
render();
if (page === "settings") loadConn(ctx);
