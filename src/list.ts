import type { ChatInfo, VecInfo } from "./api";
import type { GraphData } from "./api";

type Tab = "chats" | "memory" | "links";
type Filter = "all" | "fresh" | "long" | "fading";
export interface ListState { chats: ChatInfo[]; brain: GraphData | null; current: number; vec: VecInfo | null; building?: boolean }
export interface ListHandlers { openChat(id: number): void; focus(token: string): void; pin(tokens: string[]): void; kinds(k: string[]): void; edit(id: number, patch: { text?: string; topics?: string; pinned?: boolean }): Promise<unknown>; forget(id: number): Promise<unknown>; build(): void; setEmbedModel(m: string): void }

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
  const closed = new Set<number>(), relOpen = new Set<number>(); let locked: string | null = null, editing: number | null = null; const kindsOn = new Set(["topic", "sense", "chat"]);
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
  const textOf = (id: number) => st.brain?.messages.find((m) => m.id === id)?.preview ?? "…";
  const linksOf = (id: number) => (st.brain?.links ?? []).filter((l) => l.a === id || l.b === id).sort((x, y) => y.w - x.w);
  const why = (words: string[]) => words.length ? words.map((w) => (w === "по смыслу" || w === "из одной беседы" ? w : "тема «" + esc(w) + "»")).join(" · ") : "связаны";
  const KINDS: [string, string][] = [["topic", "Тема"], ["sense", "Смысл"], ["chat", "Беседа"]];
  const kindsOf = (l: { kinds?: string[] }) => (l.kinds?.length ? l.kinds : ["topic"]);
  function linksHtml() {
    const b = st.brain, all = b?.links ?? []; if (!all.length) return `<p class="ls-none">Связей пока нет. Они появляются, когда воспоминания из разных тем делят тему или близки по смыслу.</p>`;
    const chipsHtml = `<div class="ls-kinds" role="group" aria-label="Типы связей">${KINDS.map(([k, t]) => `<button type="button" class="ls-k ${k}" data-kind="${k}" aria-pressed="${kindsOn.has(k)}"><i></i>${t}</button>`).join("")}</div>`;
    const rows = [...all].filter((l) => kindsOf(l).some((k) => kindsOn.has(k))).sort((x, y) => y.w - x.w).filter((l) => !q || (textOf(l.a) + " " + textOf(l.b)).toLowerCase().includes(q)).slice(0, 80);
    if (!rows.length) return chipsHtml + `<p class="ls-none">Ничего не найдено.</p>`;
    return chipsHtml + `<h4 class="ls-h">Самые крепкие связи · ${all.length}</h4>` + rows.map((l) => `<button type="button" class="ls-row ls-link" data-pair="${l.a}:${l.b}"><span class="ls-kk">${kindsOf(l).map((k) => `<i class="${k}"></i>`).join("")}</span><span class="ls-t">${esc(textOf(l.a))}</span><span class="ls-x">↕ ${why(l.words)}</span><span class="ls-t">${esc(textOf(l.b))}</span><span class="ls-m">сила ${l.w.toFixed(1)}</span></button>`).join("");
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
        const rel = linksOf(m.id), open2 = relOpen.has(m.id);
        if (editing === m.id) return `<form class="ls-edit" data-form="${m.id}"><textarea rows="3" maxlength="200" aria-label="Текст воспоминания" required>${esc(m.preview)}</textarea><input type="text" value="${esc((m.topics ?? []).join(", "))}" placeholder="темы через запятую" aria-label="Темы" required /><div class="ls-eb"><button type="submit" class="ls-btn">Сохранить</button><button type="button" class="ls-btn" data-cancel="1">Отмена</button><button type="button" class="ls-btn bad" data-forget="${m.id}">Забыть</button></div></form>`;
        return `<div class="ls-mem${locked === "mem:" + m.id ? " lock" : ""}"><button type="button" class="ls-row" data-mem="${m.id}" title="${label}"><i class="dot ${dot}"></i><span class="ls-t">${m.pinned ? "📌 " : ""}${esc(m.preview)}</span><span class="ls-m">×${m.hits ?? 1} · ${ago(m.at)}</span></button><span class="ls-acts"><button type="button" class="ls-go${m.pinned ? " on" : ""}" data-pin="${m.id}" aria-pressed="${Boolean(m.pinned)}" aria-label="${m.pinned ? "Открепить" : "Закрепить, чтобы не забывалось"}" title="${m.pinned ? "Открепить" : "Закрепить: не забывается"}">📌</button><button type="button" class="ls-go" data-edit="${m.id}" aria-label="Править воспоминание" title="Править">✎</button>${m.src ? `<button type="button" class="ls-go" data-src="${m.src}" aria-label="Открыть беседу, из которой пришло воспоминание" title="Открыть беседу">↗</button>` : ""}</span>${rel.length ? `<button type="button" class="ls-rel" data-rel="${m.id}" aria-expanded="${open2}">⟷ связи ${rel.length}</button>` : ""}${open2 ? `<div class="ls-sub">${rel.slice(0, 6).map((l) => { const o = l.a === m.id ? l.b : l.a; return `<button type="button" class="ls-sr" data-mem="${o}"><span>${esc(textOf(o))}</span><em>${why(l.words)}</em></button>`; }).join("")}</div>` : ""}</div>`;
      }).join("");
      return `<section class="ls-g"><button type="button" class="ls-gh" data-area="${id}" aria-expanded="${open}"><b>${esc(areas.get(id) ?? "—")}</b><span>${ms.length}</span></button>${open ? items : ""}</section>`;
    }).join("");
  }
  function render() {
    const nm = st.brain?.messages.length ?? 0;
    tabs.innerHTML = (["chats", "memory", "links"] as Tab[]).map((t) => `<button type="button" role="tab" aria-selected="${t === tab}" data-tab="${t}">${t === "chats" ? "Беседы" : t === "memory" ? "Память" : "Связи"}<em>${t === "chats" ? st.chats.length : t === "memory" ? nm : st.brain?.links.length ?? 0}</em></button>`).join("");
    chips.hidden = tab !== "memory";
    root.querySelector(".ls-q")!.toggleAttribute("hidden", false);
    chips.innerHTML = FILTERS.map(([id, t]) => `<button type="button" role="radio" aria-checked="${id === filter}" data-f="${id}">${t}</button>`).join("");
    const top = body.scrollTop; body.innerHTML = tab === "chats" ? chatsHtml() : tab === "memory" ? memHtml() : linksHtml(); body.scrollTop = top;
  }
  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab],[data-f],[data-chat],[data-mem],[data-src],[data-area],[data-build],[data-em],[data-rel],[data-pair],[data-kind],[data-pin],[data-edit],[data-cancel],[data-forget]"); if (!t) return;
    const d = t.dataset;
    if (d.pin) { const m = st.brain?.messages.find((x) => x.id === Number(d.pin)); void h.edit(Number(d.pin), { pinned: !m?.pinned }); }
    else if (d.edit) { editing = Number(d.edit); render(); root.querySelector<HTMLTextAreaElement>(".ls-edit textarea")?.focus(); }
    else if (d.cancel) { editing = null; render(); }
    else if (d.forget) { if (confirm("Забыть это воспоминание?")) { editing = null; void h.forget(Number(d.forget)); } }
    else if (d.kind) { if (kindsOn.has(d.kind)) kindsOn.delete(d.kind); else kindsOn.add(d.kind); h.kinds([...kindsOn]); render(); }
    else if (d.build) h.build();
    else if (d.em) h.setEmbedModel(root.querySelector<HTMLInputElement>(".ls-em")?.value.trim() ?? "");
    else if (d.tab) { tab = d.tab as Tab; render(); }
    else if (d.f) { filter = d.f as Filter; render(); }
    else if (d.chat) { h.openChat(Number(d.chat)); h.focus("chat:" + d.chat); }
    else if (d.rel) { const id = Number(d.rel); if (relOpen.has(id)) relOpen.delete(id); else relOpen.add(id); render(); }
    else if (d.pair) { const [a, c] = d.pair.split(":"); locked = null; h.focus("mem:" + a); h.pin(["mem:" + a, "mem:" + c]); }
    else if (d.mem) { const tk = "mem:" + d.mem; h.focus(tk); locked = locked === tk ? null : tk; h.pin(locked ? [locked] : []); render(); }
    else if (d.src) h.openChat(Number(d.src));
    else if (d.area) { const id = Number(d.area); if (closed.has(id)) closed.delete(id); else closed.add(id); render(); }
  });
  root.addEventListener("submit", (e) => {
    const f = (e.target as HTMLElement).closest<HTMLFormElement>("form[data-form]"); if (!f) return; e.preventDefault();
    const id = Number(f.dataset.form), text = f.querySelector("textarea")!.value, topics = f.querySelector<HTMLInputElement>("input")!.value;
    editing = null; void h.edit(id, { text, topics });
  });
  root.addEventListener("mouseover", (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-mem]"); if (r && !locked) h.pin(["mem:" + r.dataset.mem]); });
  root.addEventListener("mouseout", (e) => { if ((e.target as HTMLElement).closest("[data-mem]") && !locked) h.pin([]); });
  input.addEventListener("input", () => { q = input.value.trim().toLowerCase(); render(); });
  render();
  return { update(s: ListState) { st = s; render(); } };
}
