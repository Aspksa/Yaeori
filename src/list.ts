import type { ChatInfo, Dispute, Entity, Inactive, RecallCfg, Review, SleepInfo, VecInfo } from "./api";
import type { GraphData } from "./api";

type Tab = "chats" | "memory" | "links";
type Filter = "all" | "fresh" | "long" | "fading";
export interface ListState { chats: ChatInfo[]; brain: GraphData | null; current: number; vec: VecInfo | null; building?: boolean }
export interface ListHandlers { more(areaId: number): void; openChat(id: number): void; focus(token: string): void; pin(tokens: string[]): void; kinds(k: string[]): void; edit(id: number, patch: { text?: string; topics?: string; pinned?: boolean }): Promise<unknown>; forget(id: number): Promise<unknown>; review(): Promise<Review>; merge(keep: number, drop: number[], history?: boolean): Promise<unknown>; compress(ids: number[], text: string, topic: string): Promise<unknown>; inactive(): Promise<Inactive[]>; entities(): Promise<Entity[]>; restore(id: number): Promise<unknown>; recallCfg(): Promise<RecallCfg>; setRecallCfg(c: { weights?: RecallCfg["weights"]; rerank?: boolean }): Promise<RecallCfg>; disputes(): Promise<Dispute[]>; resolve(a: number, b: number, keep: number | null): Promise<unknown>; sleepInfo(): Promise<{ last: SleepInfo | null; sleeping: boolean }>; sleep(): Promise<SleepInfo>; build(): void; setEmbedModel(m: string): void }

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
  let cfg: RecallCfg | null = null, cfgAsked = false, cfgNote = "", disp: Dispute[] | null = null, dispAsked = false;
  let slp: { last: SleepInfo | null; sleeping: boolean } | null = null, slpBusy = false, slpAsked = false;
  const closed = new Set<number>(), pages = new Map<number, number>(), relOpen = new Set<number>(); let locked: string | null = null, editing: number | null = null, rev: Review | null = null, revBusy = false, revNote = "", archOpen = false, inact: Inactive[] | null = null, ents: Entity[] | null = null, entLoading = false; const entOpen = new Set<number>(), kindsOn = new Set(["topic", "sense", "chat", "entity", "habit"]);
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
  const why = (words: string[]) => words.length ? words.map((w) => (w === "по смыслу" || w === "из одной беседы" ? w : w.startsWith("@") ? "«" + esc(w.slice(1)) + "»" : "тема «" + esc(w) + "»")).join(" · ") : "связаны";
  const KINDS: [string, string][] = [["topic", "Тема"], ["sense", "Смысл"], ["chat", "Беседа"], ["entity", "Сущность"], ["habit", "Привычка"]];
  const kindsOf = (l: { kinds?: string[] }) => (l.kinds?.length ? l.kinds : ["topic"]);
  function entitiesHtml() {
    if (!ents) { if (!entLoading) { entLoading = true; void h.entities().then((x) => { ents = x; }, () => { ents = []; }).finally(() => { entLoading = false; render(); }); } return ""; }
    const rows = ents.filter((e) => !q || e.name.toLowerCase().includes(q)).slice(0, 40); if (!rows.length) return "";
    return `<h4 class="ls-h">Сущности · ${ents.length}</h4>` + rows.map((e) => {
      const open = entOpen.has(e.id), rel = e.relations.length ? e.relations.map((r) => `<p class="${r.past ? "past" : ""}">${esc(r.s)} <em>${esc(r.r)}</em> ${esc(r.o)}${r.past ? " · раньше" : ""}</p>`).join("") : "";
      const mems = open ? e.memories.map((id) => `<button type="button" class="ls-row ls-sub" data-mem="${id}"><span class="ls-t">${esc(textOf(id))}</span></button>`).join("") : "";
      return `<div class="ls-ent"><button type="button" class="ls-row" data-ent="${e.id}" aria-expanded="${open}"><i class="dot sq"></i><span class="ls-t">${esc(e.name)}</span><span class="ls-m">${e.memories.length}</span></button>${open ? rel + mems : ""}</div>`;
    }).join("");
  }
  function linksHtml() {
    const b = st.brain, all = b?.links ?? []; if (!all.length) return `<p class="ls-none">Связей пока нет. Они появляются, когда воспоминания из разных тем делят тему или близки по смыслу.</p>`;
    const chipsHtml = `<div class="ls-kinds" role="group" aria-label="Типы связей">${KINDS.map(([k, t]) => `<button type="button" class="ls-k ${k}" data-kind="${k}" aria-pressed="${kindsOn.has(k)}"><i></i>${t}</button>`).join("")}</div>`;
    const rows = [...all].filter((l) => kindsOf(l).some((k) => kindsOn.has(k))).sort((x, y) => y.w - x.w).filter((l) => !q || (textOf(l.a) + " " + textOf(l.b)).toLowerCase().includes(q)).slice(0, 80);
    if (!rows.length) return chipsHtml + `<p class="ls-none">Ничего не найдено.</p>`;
    return chipsHtml + entitiesHtml() + `<h4 class="ls-h">Самые крепкие связи · ${all.length}</h4>` + rows.map((l) => `<button type="button" class="ls-row ls-link" data-pair="${l.a}:${l.b}"><span class="ls-kk">${kindsOf(l).map((k) => `<i class="${k}"></i>`).join("")}</span><span class="ls-t">${esc(textOf(l.a))}</span><span class="ls-x">↕ ${why(l.words)}</span><span class="ls-t">${esc(textOf(l.b))}</span><span class="ls-m">сила ${l.w.toFixed(1)}</span></button>`).join("");
  }
  const loadDisp = () => void h.disputes().then((x) => { disp = x; render(); }, () => {});
  function disputeHtml() {
    if (!dispAsked) { dispAsked = true; loadDisp(); }
    if (!disp?.length) return "";
    return `<div class="ls-vec"><div class="ls-vh"><b>Спорное</b><span>${disp.length}</span></div><small>Эти факты не могут быть верны оба. Пока вы не решили, ассистент говорит о них осторожно.</small>${disp.map((d, i) => `<div class="ls-card warn"><div class="ls-ct">${esc(d.reason)}</div><p>${esc(d.a.text)}</p><p>${esc(d.b.text)}</p><div class="ls-eb"><button type="button" class="ls-btn" data-dk-a="${i}">Верно первое</button><button type="button" class="ls-btn" data-dk-b="${i}">Верно второе</button><button type="button" class="ls-btn" data-dk-both="${i}">Оба верны</button></div></div>`).join("")}</div>`;
  }
  function cfgHtml() {
    if (!cfgAsked) { cfgAsked = true; void h.recallCfg().then((x) => { cfg = x; render(); }, () => {}); }
    if (!cfg) return "";
    const sl = (k: "vec" | "lex" | "imp", label: string) => `<label class="ls-sl">${label}<input type="range" min="0" max="2" step="0.1" value="${cfg!.weights[k]}" data-w="${k}" aria-label="${label}" /></label>`;
    return `<details class="ls-vec"><summary><b>Как искать</b></summary><small>Что важнее при вспоминании. По умолчанию всё поровну.</small>${sl("vec", "По смыслу")}${sl("lex", "По словам")}${sl("imp", "Важность и свежесть")}
      <label class="ls-ck"><input type="checkbox" data-rr="1"${cfg.rerank ? " checked" : ""} /> Переранжировать моделью (точнее, но каждый ответ чуть дольше)</label><div class="ls-vb"><button type="button" class="ls-btn" data-cfg="1">Сохранить</button>${cfgNote ? `<small>${esc(cfgNote)}</small>` : ""}</div></details>`;
  }
  function sleepHtml() {
    if (!slpAsked) { slpAsked = true; void h.sleepInfo().then((x) => { slp = x; render(); }, () => {}); }
    const l = slp?.last, txt = l ? `Последний раз ${ago(l.at)}: слито ${l.merged}, сжато ${l.compressed}, забыто ${l.archived}${l.backup ? `, копия ${esc(l.backup)}` : ""}.` : "Ещё не спала. Сама убирается по ночам.";
    return `<div class="ls-vec"><div class="ls-vh"><b>Сон</b></div><small>${txt}</small><div class="ls-vb"><button type="button" class="ls-btn" data-sleep="1"${slpBusy || slp?.sleeping ? " disabled" : ""}>${slpBusy || slp?.sleeping ? "Убираюсь…" : "Выспаться сейчас"}</button></div></div>`;
  }
  function reviewHtml() {
    const head = `<div class="ls-vec"><div class="ls-vh"><b>Порядок в памяти</b></div><small>Ищет дубли и факты, которые спорят друг с другом.</small><div class="ls-vb"><button type="button" class="ls-btn" data-review="1"${revBusy ? " disabled" : ""}>${revBusy ? "Проверяю…" : "Проверить дубли и противоречия"}</button></div>${revNote ? `<small>${esc(revNote)}</small>` : ""}</div>`;
    if (!rev) return head;
    const merges = rev.merges.map((g, gi) => `<div class="ls-card"><div class="ls-ct">Похожие, ${g.items.length}</div>${g.items.map((i) => `<p class="${i.id === g.keep ? "keep" : ""}">${i.pinned ? "📌 " : ""}${esc(i.text)} <em>×${i.hits}</em></p>`).join("")}<div class="ls-eb"><button type="button" class="ls-btn" data-mg="${gi}">Объединить в одно</button><button type="button" class="ls-btn" data-skip-mg="${gi}">Оставить как есть</button></div></div>`).join("");
    const conf = rev.conflicts.map((c, ci) => `<div class="ls-card warn"><div class="ls-ct">Спорят друг с другом</div><p>${esc(c.a.text)}</p><p>${esc(c.b.text)}</p>${c.why ? `<small>${esc(c.why)}</small>` : ""}<div class="ls-eb"><button type="button" class="ls-btn" data-keep-a="${ci}">Верно первое</button><button type="button" class="ls-btn" data-keep-b="${ci}">Верно второе</button><button type="button" class="ls-btn" data-skip-cf="${ci}">Оба верны</button></div></div>`).join("");
    const comp = (rev.compress ?? []).map((g, gi) => `<div class="ls-card"><div class="ls-ct">Сжать ${g.ids.length} старых («${esc(g.topic)}») в одно</div><p class="keep">${esc(g.summary)}</p><small>${g.items.map((x) => esc(x)).join(" · ").slice(0, 300)}</small><div class="ls-eb"><button type="button" class="ls-btn" data-cp="${gi}">Сжать</button><button type="button" class="ls-btn" data-skip-cp="${gi}">Оставить как есть</button></div></div>`).join("");
    const none = !merges && !conf && !comp ? `<p class="ls-none">Дублей, противоречий и старых россыпей не найдено.</p>` : "";
    return head + merges + conf + comp + (rev.conflictsError ? `<small class="ls-warn">${esc(rev.conflictsError)}</small>` : "") + none;
  }
  function archiveHtml() {
    const list = !archOpen ? "" : !inact ? `<small>Загружаю…</small>` : !inact.length ? `<p class="ls-none">Архив пуст.</p>` : inact.map((x) => `<div class="ls-card${x.state === "replaced" ? " warn" : ""}"><p>${esc(x.text)}</p><small>${x.state === "archived" ? "затухло — давно не вспоминалось" : x.replacedText ? "заменено: " + esc(x.replacedText) : "заменено новым"}</small><div class="ls-eb"><button type="button" class="ls-btn" data-restore="${x.id}">Вернуть</button></div></div>`).join("");
    return `<div class="ls-vec"><div class="ls-vh"><b>Архив и история</b></div><small>Затухшие и замещённые воспоминания. Закреплённые не затухают.</small><div class="ls-vb"><button type="button" class="ls-btn" data-arch="1">${archOpen ? "Скрыть" : "Показать"}</button></div></div>${list}`;
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
    const strip = vecHtml() + disputeHtml() + cfgHtml() + sleepHtml() + reviewHtml() + archiveHtml();
    const areas = new Map(b.chats.map((c) => [c.id, c.title] as const)), by = new Map<number, typeof b.messages>();
    for (const m of b.messages) {
      if (filter !== "all" && m.tier !== filter) continue;
      if (q && !(m.preview.toLowerCase().includes(q) || (areas.get(m.chatId) ?? "").toLowerCase().includes(q))) continue;
      (by.get(m.chatId) ?? by.set(m.chatId, []).get(m.chatId)!).push(m);
    }
    if (!by.size) return strip + `<p class="ls-none">Ничего не найдено.</p>`;
    const groups = [...by].sort((a, c) => c[1].length - a[1].length);
    return strip + groups.map(([id, ms]) => {
      const open = q || filter !== "all" || !closed.has(id), lim = q || filter !== "all" ? ms.length : pages.get(id) ?? 30, meta = b.chats.find((c) => c.id === id);
      const items = ms.sort((x, y) => (y.hits ?? 1) - (x.hits ?? 1) || Date.parse(y.at) - Date.parse(x.at)).slice(0, lim).map((m) => {
        const [dot, label] = TIER[m.tier ?? "plain"]!;
        const rel = linksOf(m.id), open2 = relOpen.has(m.id);
        if (editing === m.id) return `<form class="ls-edit" data-form="${m.id}"><textarea rows="3" maxlength="200" aria-label="Текст воспоминания" required>${esc(m.preview)}</textarea><input type="text" value="${esc((m.topics ?? []).join(", "))}" placeholder="темы через запятую" aria-label="Темы" required /><div class="ls-eb"><button type="submit" class="ls-btn">Сохранить</button><button type="button" class="ls-btn" data-cancel="1">Отмена</button><button type="button" class="ls-btn bad" data-forget="${m.id}">Забыть</button></div></form>`;
        return `<div class="ls-mem${locked === "mem:" + m.id ? " lock" : ""}"><button type="button" class="ls-row" data-mem="${m.id}" title="${label}"><i class="dot ${dot}"></i><span class="ls-t">${m.pinned ? "📌 " : ""}${esc(m.preview)}</span><span class="ls-m">×${m.hits ?? 1} · ${ago(m.at)}</span></button><span class="ls-acts"><button type="button" class="ls-go${m.pinned ? " on" : ""}" data-pin="${m.id}" aria-pressed="${Boolean(m.pinned)}" aria-label="${m.pinned ? "Открепить" : "Закрепить, чтобы не забывалось"}" title="${m.pinned ? "Открепить" : "Закрепить: не забывается"}">📌</button><button type="button" class="ls-go" data-edit="${m.id}" aria-label="Править воспоминание" title="Править">✎</button>${m.src ? `<button type="button" class="ls-go" data-src="${m.src}" aria-label="Открыть беседу, из которой пришло воспоминание" title="Открыть беседу">↗</button>` : ""}</span>${rel.length ? `<button type="button" class="ls-rel" data-rel="${m.id}" aria-expanded="${open2}">⟷ связи ${rel.length}</button>` : ""}${open2 ? `<div class="ls-sub">${rel.slice(0, 6).map((l) => { const o = l.a === m.id ? l.b : l.a; return `<button type="button" class="ls-sr" data-mem="${o}"><span>${esc(textOf(o))}</span><em>${why(l.words)}</em></button>`; }).join("")}</div>` : ""}</div>`;
      }).join("");
      const more = ms.length > lim ? `<button type="button" class="ls-more" data-pg="${id}">Показать ещё ${Math.min(30, ms.length - lim)}</button>` : meta?.hidden ? `<button type="button" class="ls-more" data-more="${id}">Загрузить ещё ${Math.min(meta.hidden, 150)} из памяти</button>` : "";
      return `<section class="ls-g"><button type="button" class="ls-gh" data-area="${id}" aria-expanded="${open}"><b>${esc(areas.get(id) ?? "—")}</b><span>${meta?.count ?? ms.length}</span></button>${open && meta?.summary ? `<p class="ls-sum">${esc(meta.summary)}</p>` : ""}${open ? items + more : ""}</section>`;
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
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cfg],[data-dk-a],[data-dk-b],[data-dk-both],[data-sleep],[data-pg],[data-more],[data-tab],[data-f],[data-chat],[data-mem],[data-src],[data-area],[data-build],[data-em],[data-rel],[data-pair],[data-kind],[data-pin],[data-edit],[data-cancel],[data-forget],[data-review],[data-mg],[data-skip-mg],[data-keep-a],[data-keep-b],[data-skip-cf],[data-cp],[data-skip-cp],[data-arch],[data-restore],[data-ent]"); if (!t) return;
    const d = t.dataset;
    if (d.review) { revBusy = true; revNote = ""; render(); void h.review().then((r) => { rev = r; }, (e: Error) => { revNote = e.message; }).finally(() => { revBusy = false; render(); }); }
    else if (d.mg) { const g = rev?.merges[Number(d.mg)]; if (g) { rev!.merges.splice(Number(d.mg), 1); void h.merge(g.keep, g.items.filter((i) => i.id !== g.keep).map((i) => i.id)); render(); } }
    else if (d.skipMg) { rev?.merges.splice(Number(d.skipMg), 1); render(); }
    else if (d.keepA || d.keepB) { const i = Number(d.keepA ?? d.keepB), c = rev?.conflicts[i]; if (c) { rev!.conflicts.splice(i, 1); const [win, lose] = d.keepA !== undefined ? [c.a, c.b] : [c.b, c.a]; void h.merge(win.id, [lose.id], true); render(); } }
    else if (d.cp) { const g = rev?.compress?.[Number(d.cp)]; if (g) { rev!.compress!.splice(Number(d.cp), 1); void h.compress(g.ids, g.summary, g.topic); render(); } }
    else if (d.skipCp) { rev?.compress?.splice(Number(d.skipCp), 1); render(); }
    else if (d.arch) { archOpen = !archOpen; if (archOpen) { void h.inactive().then((x) => { inact = x; render(); }); } render(); }
    else if (d.restore) { inact = inact?.filter((x) => x.id !== Number(d.restore)) ?? null; void h.restore(Number(d.restore)); render(); }
    else if (d.skipCf) { rev?.conflicts.splice(Number(d.skipCf), 1); render(); }
    else if (d.ent) { const id = Number(d.ent), e = ents?.find((x) => x.id === id); if (entOpen.has(id)) { entOpen.delete(id); locked = null; h.pin([]); } else { entOpen.clear(); entOpen.add(id); if (e) { locked = "ent:" + id; h.pin(e.memories.map((m) => "mem:" + m)); h.focus("mem:" + e.memories[0]); } } render(); }
    else if (d.pin) { const m = st.brain?.messages.find((x) => x.id === Number(d.pin)); void h.edit(Number(d.pin), { pinned: !m?.pinned }); }
    else if (d.edit) { editing = Number(d.edit); render(); root.querySelector<HTMLTextAreaElement>(".ls-edit textarea")?.focus(); }
    else if (d.cancel) { editing = null; render(); }
    else if (d.forget) { if (confirm("Забыть это воспоминание?")) { editing = null; void h.forget(Number(d.forget)); } }
    else if (d.kind) { if (kindsOn.has(d.kind)) kindsOn.delete(d.kind); else kindsOn.add(d.kind); h.kinds([...kindsOn]); render(); }
    else if (d.build) h.build();
    else if (d.em) h.setEmbedModel(root.querySelector<HTMLInputElement>(".ls-em")?.value.trim() ?? "");
    else if (d.dkA !== undefined || d.dkB !== undefined || d.dkBoth !== undefined) { const i = Number(d.dkA ?? d.dkB ?? d.dkBoth), x = disp?.[i]; if (x) { disp!.splice(i, 1); void h.resolve(x.a.id, x.b.id, d.dkBoth !== undefined ? null : d.dkA !== undefined ? x.a.id : x.b.id); render(); } }
    else if (d.cfg) { const w = { vec: 1, lex: 1, imp: 1 }; root.querySelectorAll<HTMLInputElement>("[data-w]").forEach((el) => { w[el.dataset.w as "vec" | "lex" | "imp"] = Number(el.value); }); const rerank = root.querySelector<HTMLInputElement>("[data-rr]")?.checked ?? false; void h.setRecallCfg({ weights: w, rerank }).then((x) => { cfg = x; cfgNote = "Сохранено"; }, () => { cfgNote = "Не удалось сохранить"; }).finally(render); }
    else if (d.sleep) { slpBusy = true; render(); void h.sleep().then((x) => { slp = { last: x, sleeping: false }; }, () => {}).finally(() => { slpBusy = false; render(); }); }
    else if (d.pg) { pages.set(Number(d.pg), (pages.get(Number(d.pg)) ?? 30) + 30); render(); }
    else if (d.more) { h.more(Number(d.more)); }
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
  return { update(s: ListState) { st = s; ents = null; render(); } };
}
