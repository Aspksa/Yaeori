import type { ChatInfo, VecInfo } from "./api";
import type { GraphData } from "./api";

type Tab = "chats" | "memory";
type Filter = "all" | "fresh" | "long" | "fading";
export interface ListState { chats: ChatInfo[]; brain: GraphData | null; current: number; vec: VecInfo | null; building?: boolean }
export interface ListHandlers { openChat(id: number): void; focus(token: string): void; build(): void; setEmbedModel(m: string): void }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const DAY = 86400000;
const bucket = (iso: string) => {
  const d = Date.parse(iso), t = new Date(); t.setHours(0, 0, 0, 0);
  const age = Math.floor((t.getTime() - d) / DAY) + 1;
  if (d >= t.getTime()) return "Сегодня"; if (age <= 1) return "Вчера"; if (age <= 7) return "На этой неделе"; if (age <= 31) return "В этом месяце"; return "Раньше";
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!(m >= 0)) return ""; if (m < 1) return "только что"; if (m < 60) return `${m} мин назад`; if (m < 1440) return `${Math.floor(m / 60)} ч назад`; const d = Math.floor(m / 1440); return d < 31 ? `${d} дн назад` : new Date(iso).toLocaleDateString("ru-RU");
};
const TIER: Record<string, [string, string]> = { fresh: ["you", "свежая"], long: ["long", "долгая"], fading: ["fade", "забывается"], plain: ["bot", "обычная"] };
const FILTERS: [Filter, string][] = [["all", "Все"], ["fresh", "Свежие"], ["long", "Долгие"], ["fading", "Забываются"]];

/** Список слева от карты: беседы по датам и воспоминания по темам. Клик — перелёт камеры к узлу. */
export function mountList(root: HTMLElement, h: ListHandlers) {
  let tab: Tab = "chats", q = "", filter: Filter = "all", st: ListState = { chats: [], brain: null, current: 0, vec: null };
  const closed = new Set<number>();
  root.innerHTML = `<div class="ls-top"><div class="ls-tabs" role="tablist" aria-label="Что показывать в списке"></div>
    <input class="ls-q" type="search" placeholder="Найти…" autocomplete="off" spellcheck="false" aria-label="Поиск по списку" /><div class="ls-chips" role="radiogroup" aria-label="Фильтр памяти" hidden></div></div>
    <div class="ls-body" tabindex="-1"></div>`;
  const tabs = root.querySelector<HTMLElement>(".ls-tabs")!, input = root.querySelector<HTMLInputElement>(".ls-q")!, chips = root.querySelector<HTMLElement>(".ls-chips")!, body = root.querySelector<HTMLElement>(".ls-body")!;

  function chatsHtml() {
    const rows = [...st.chats].sort((a, b) => b.id - a.id).filter((c) => !q || c.title.toLowerCase().includes(q));
    if (!rows.length) return `<p class="ls-none">${q ? "Ничего не найдено." : "Бесед пока нет."}</p>`;
    let last = "", out = "";
    for (const c of rows) {
      const b = bucket(c.createdAt); if (b !== last) { out += `<h4 class="ls-h">${b}</h4>`; last = b; }
      out += `<button type="button" class="ls-row${c.id === st.current ? " on" : ""}" data-chat="${c.id}"><span class="ls-t">${esc(c.title)}</span><span class="ls-m">${c.count} сообщ. · ${ago(c.createdAt)}</span></button>`;
    }
    return out;
  }
  function vecHtml() {
    const v = st.vec; if (!v) return "";
    const pct = v.total ? Math.round((v.indexed / v.total) * 100) : 0, state = v.ok === false ? `<em class="bad">${esc(v.error || "Векторы не работают")}</em>` : v.indexed < v.total ? "считаются автоматически…" : v.total ? "поиск по смыслу работает" : v.model ? `модель ${esc(v.model)}` : "модель не найдена";
    return `<div class="ls-vec"><div class="ls-vh"><b>Векторы</b><span>${v.indexed} / ${v.total}</span></div><div class="ls-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <small>${state}</small><div class="ls-vb"><button type="button" class="ls-btn" data-build="1"${st.building || v.indexed >= v.total ? " disabled" : ""}>${st.building ? "Считаю…" : "Посчитать сейчас"}</button>
      <details><summary>Модель эмбеддингов</summary><input class="ls-em" type="text" value="${esc(v.model)}" placeholder="например bge-m3" spellcheck="false" aria-label="Модель эмбеддингов" /><button type="button" class="ls-btn" data-em="1">Сохранить</button></details></div></div>`;
  }
  function memHtml() {
    const b = st.brain; if (!b || !b.messages.length) return `<p class="ls-none">Мозг пока пуст. Он растёт, пока вы общаетесь.</p>`;
    const strip = vecHtml();
    const areas = new Map(b.chats.map((c) => [c.id, c.title] as const)), by = new Map<number, typeof b.messages>();
    for (const m of b.messages) {
      if (filter !== "all" && m.tier !== filter) continue;
      if (q && !(m.preview.toLowerCase().includes(q) || (areas.get(m.chatId) ?? "").toLowerCase().includes(q))) continue;
      (by.get(m.chatId) ?? by.set(m.chatId, []).get(m.chatId)!).push(m);
    }
    if (!by.size) return strip + `<p class="ls-none">Ничего не найдено.</p>`;
    const groups = [...by].sort((a, c) => c[1].length - a[1].length);
    return strip + groups.map(([id, ms]) => {
      const open = q || filter !== "all" || !closed.has(id);
      const items = ms.sort((x, y) => (y.hits ?? 1) - (x.hits ?? 1) || Date.parse(y.at) - Date.parse(x.at)).map((m) => {
        const [dot, label] = TIER[m.tier ?? "plain"]!;
        return `<div class="ls-mem"><button type="button" class="ls-row" data-mem="${m.id}" title="${label}"><i class="dot ${dot}"></i><span class="ls-t">${esc(m.preview)}</span><span class="ls-m">×${m.hits ?? 1} · ${ago(m.at)}</span></button>${m.src ? `<button type="button" class="ls-go" data-src="${m.src}" aria-label="Открыть беседу, из которой пришло воспоминание" title="Открыть беседу">↗</button>` : ""}</div>`;
      }).join("");
      return `<section class="ls-g"><button type="button" class="ls-gh" data-area="${id}" aria-expanded="${open}"><b>${esc(areas.get(id) ?? "—")}</b><span>${ms.length}</span></button>${open ? items : ""}</section>`;
    }).join("");
  }
  function render() {
    const nm = st.brain?.messages.length ?? 0;
    tabs.innerHTML = (["chats", "memory"] as Tab[]).map((t) => `<button type="button" role="tab" aria-selected="${t === tab}" data-tab="${t}">${t === "chats" ? "Беседы" : "Память"}<em>${t === "chats" ? st.chats.length : nm}</em></button>`).join("");
    chips.hidden = tab !== "memory";
    chips.innerHTML = FILTERS.map(([id, t]) => `<button type="button" role="radio" aria-checked="${id === filter}" data-f="${id}">${t}</button>`).join("");
    const top = body.scrollTop; body.innerHTML = tab === "chats" ? chatsHtml() : memHtml(); body.scrollTop = top;
  }
  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab],[data-f],[data-chat],[data-mem],[data-src],[data-area],[data-build],[data-em]"); if (!t) return;
    const d = t.dataset;
    if (d.build) h.build();
    else if (d.em) h.setEmbedModel(root.querySelector<HTMLInputElement>(".ls-em")?.value.trim() ?? "");
    else if (d.tab) { tab = d.tab as Tab; render(); }
    else if (d.f) { filter = d.f as Filter; render(); }
    else if (d.chat) { h.openChat(Number(d.chat)); h.focus("chat:" + d.chat); }
    else if (d.mem) h.focus("mem:" + d.mem);
    else if (d.src) h.openChat(Number(d.src));
    else if (d.area) { const id = Number(d.area); if (closed.has(id)) closed.delete(id); else closed.add(id); render(); }
  });
  input.addEventListener("input", () => { q = input.value.trim().toLowerCase(); render(); });
  render();
  return { update(s: ListState) { st = s; render(); } };
}
