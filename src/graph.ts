import type { GraphData } from "./api";

export type Layout = "sectors" | "rings" | "circle" | "hex" | "tile" | "hud" | "force";
export type MapTheme = "accent" | "night" | "ocean" | "neon" | "bordo" | "paper";
export type Grouping = "chat" | "day";
export interface MapOptions { layout: Layout; theme: MapTheme; group: Grouping; rotation: number; force: number; size: number; labels: boolean; links: boolean; collapsed: string[] }
export const DEFAULT_MAP: MapOptions = { layout: "sectors", theme: "night", group: "chat", rotation: 0.25, force: 0.5, size: 1, labels: false, links: true, collapsed: [] };
export const MAP_THEMES: { id: MapTheme; label: string; swatch: string[] }[] = [
  { id: "accent", label: "По акценту", swatch: ["#d9a441", "#a78bfa", "#6fcf97", "#f0a030"] },
  { id: "night", label: "Ночь (как на примере)", swatch: ["#4fd1b0", "#f0a24a", "#8b7cf6", "#5aa0ff"] },
  { id: "ocean", label: "Океан", swatch: ["#4cc9a4", "#4aa8e8", "#7c9cff", "#e6c35c"] },
  { id: "neon", label: "Неон", swatch: ["#d6ff3d", "#ff3dac", "#3dffe0", "#ffb13d"] },
  { id: "bordo", label: "Бордо", swatch: ["#f0a35c", "#e05a6b", "#d9c27a", "#c97bb0"] },
  { id: "paper", label: "Бумага", swatch: ["#8a5a1c", "#2f6f8f", "#6b3fa0", "#2f7f4f"] },
];
export interface SysItem { id: string; label: string; detail: string; ok: boolean; icon: "key" | "spark" | "db" | "chat" | "palette"; group?: "chat"; chatId?: number; on?: boolean }

export type Col = "user" | "bot" | "accent" | "gold" | "mint";
export interface EntityInfo { id: number; name: string; memories: number[] }
interface Pal { bg: string; hubs: string[]; user: string; bot: string; line: string; text: string; muted: string; warn: string }
const FIXED: Record<Exclude<MapTheme, "accent">, Pal> = {
  night: { bg: "#07121d", hubs: ["#4fd1b0", "#f0a24a", "#8b7cf6", "#5aa0ff", "#7fe0c8", "#e8836a", "#b9a8ff", "#93c5fd"], user: "#4fd1b0", bot: "#8b7cf6", line: "rgba(110,190,200,.20)", text: "#d6ece8", muted: "#6f93a0", warn: "#f0a24a" },
  ocean: { bg: "#0b1822", hubs: ["#4cc9a4", "#4aa8e8", "#7c9cff", "#e6c35c", "#f08c6a", "#b48cf0"], user: "#4cc9a4", bot: "#4aa8e8", line: "rgba(120,200,220,.22)", text: "#d4f1ea", muted: "#7fa9b3", warn: "#e6c35c" },
  neon: { bg: "#05050a", hubs: ["#d6ff3d", "#ff3dac", "#3dffe0", "#ffb13d", "#a35bff", "#3d8bff"], user: "#d6ff3d", bot: "#ff3dac", line: "rgba(255,255,255,.16)", text: "#f2f2f2", muted: "#9a9aa8", warn: "#ffb13d" },
  bordo: { bg: "#160a0c", hubs: ["#f0a35c", "#e05a6b", "#d9c27a", "#c97bb0", "#e8855c", "#a8c6a0"], user: "#f0a35c", bot: "#e05a6b", line: "rgba(255,170,150,.18)", text: "#f6e2db", muted: "#b38d86", warn: "#d9c27a" },
  paper: { bg: "#f6f1e6", hubs: ["#8a5a1c", "#2f6f8f", "#6b3fa0", "#2f7f4f", "#b3402f", "#4a4a8a"], user: "#8a5a1c", bot: "#2f6f8f", line: "rgba(0,0,0,.18)", text: "#2a2418", muted: "#7a705c", warn: "#b3402f" },
};
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function palette(t: MapTheme): Pal {
  if (t !== "accent") return FIXED[t];
  const brand = css("--brand") || "#d9a441", violet = css("--violet") || "#a78bfa";
  return { bg: css("--surface") || "#141417", hubs: [brand, violet, css("--ok") || "#6fcf97", css("--warn") || "#f0a030", css("--danger") || "#f87171", css("--muted") || "#b4b4bd"],
    user: brand, bot: violet, line: css("--line") || "rgba(255,255,255,.1)", text: css("--fg") || "#ececf1", muted: css("--muted") || "#b4b4bd", warn: css("--warn") || "#f0a030" };
}

/** Линейные значки 24×24 (как в наборе Lucide), рисуются прямо на холсте. */
const ICONS: Record<SysItem["icon"], string> = {
  key: "M21 2l-2 2M11.4 11.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM11.4 11.6L15.5 7.5M15.5 7.5l3 3L22 7l-3-3M15.5 7.5L19 4",
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z",
  db: "M3 5c0-1.1 4-2 9-2s9 .9 9 2-4 2-9 2-9-.9-9-2zM3 5v14c0 1.1 4 2 9 2s9-.9 9-2V5M3 12c0 1.1 4 2 9 2s9-.9 9-2",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  palette: "M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A3.7 3.7 0 0 0 21 10.7C21 6.4 16.9 3 12 3zM7.5 11h.01M10 7.5h.01M14 7.5h.01",
};
const PATHS = Object.fromEntries(Object.entries(ICONS).map(([k, d]) => [k, new Path2D(d)])) as Record<SysItem["icon"], Path2D>;

type Kind = "core" | "hub" | "msg" | "sys";
interface N { key: string; kind: Kind; id: number; chatId: number; grp: string; role?: "user" | "assistant"; text: string; size: number; at: string; x: number; y: number; tx: number; ty: number; vx: number; vy: number; born: number; hue: number; visible: boolean; key2?: boolean; sys?: SysItem; tier?: string; hits?: number; src?: number; shown?: boolean }
export interface GraphHandle {
  destroy(): void; update(d: GraphData): void; select(chatId: number | null): void;
  setOptions(p: Partial<MapOptions>): void; options(): MapOptions; setSystem(items: SysItem[]): void;
  expandAll(): void; collapseAll(): void; recenter(): void; search(q: string): void; png(): Promise<Blob | null>; show(on: boolean): boolean;
  /** Импульс по цепочке узлов: "core", "chat:ID", "mem:ID" (через свою тему). col: кто посылает. */
  flow(path: string[], col: Col, delay?: number): void; flash(tokens: string[], col: Col): void; think(on: boolean): void; focus(token: string): void; pin(tokens: string[]): void; setLinkKinds(kinds: string[]): void; setEntities(list: EntityInfo[]): void;
}
interface Callbacks { onPick: (chatId: number) => void; onCollapse?: (keys: string[]) => void; onSystem?: (id: string) => void; onEntity?: (id: number | null) => void; onShowEnd?: () => void }

export const AREA_OFF = 1_000_000, NEURON_OFF = 1_000_000_000;
const R = 300, MONO = "ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace", SANS = "Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif", TAU = Math.PI * 2;
const hexCell = (i: number): [number, number] => {
  const r1: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  if (i === 0) return [0, 0];
  if (i <= 6) return r1[i - 1]!;
  const j = i - 7, side = Math.floor(j / 2), c = r1[side % 6]!, nx = r1[(side + 1) % 6]!;
  return j % 2 === 0 ? [c[0] * 2, c[1] * 2] : [c[0] + nx[0], c[1] + nx[1]];
};
const TILE = 112;
const tileCell = (i: number): [number, number] => { // квадратная спираль от центра
  let x = 0, y = 0, dx = 1, dy = 0, seg = 1, left = 1, turns = 0;
  for (let k = 0; k < i; k++) { x += dx; y += dy; if (--left === 0) { [dx, dy] = [-dy, dx]; if (++turns % 2 === 0) seg++; left = seg; } }
  return [x, y];
};
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayLabel = (k: string) => { const [, m, d] = k.split("-"); return `${d}.${m}`; };

export function mountGraph(canvas: HTMLCanvasElement, tip: HTMLElement, cb: Callbacks, initial: MapOptions = DEFAULT_MAP): GraphHandle {
  const ctx = canvas.getContext("2d")!;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let o: MapOptions = { ...DEFAULT_MAP, ...initial };
  let data: GraphData = { chats: [], messages: [], links: [] }, sysItems: SysItem[] = [];
  const nodes = new Map<string, N>(); let order: N[] = [];
  let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now(), rot = 0, selected: number | null = null, query = "";
  let cam = { x: 0, y: 0, k: 1 }, fitted = false, hover: N | null = null, mouse: { x: number; y: number } | null = null;
  let drag: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null, pal = palette(o.theme), palAt = 0;
  let tour: { on: boolean; i: number; at: number } = { on: false, i: -1, at: 0 };
  const seen = new Set<number>();
  interface Fx { keys: string[]; t0: number; dur: number; col: Col; reached: number }
  let linkKinds = new Set(["topic", "sense", "chat", "entity"]);
  let pin: Set<string> | null = null; const pinNb = new Set<string>();
  let camGoal: { x: number; y: number; k: number } | null = null;
  const fxs: Fx[] = [], rings: { key: string; t0: number; col: Col; burst?: boolean }[] = []; let ents: EntityInfo[] = [], entSel: number | null = null, entHover: number | null = null; let thinking = false, lastThink = 0;
  const resolve = (tokens: string[]) => tokens.flatMap((t) => {
    if (t === "core") return ["core"];
    if (t.startsWith("chat:")) return nodes.has("hc" + t.slice(5)) ? ["hc" + t.slice(5)] : [];
    if (t.startsWith("mem:")) { const k = "m" + (NEURON_OFF + Number(t.slice(4))), n = nodes.get(k); return n ? [...(nodes.has("h" + n.grp) ? ["h" + n.grp] : []), k] : []; }
    return [];
  });
  const neu = (n: N) => n.tier !== undefined, isArea = (n: N) => n.kind === "hub" && n.chatId >= AREA_OFF;

  const fitK = () => Math.min(w, h) / (R * 2.5);
  const fit = () => { cam = { x: 0, y: 0, k: fitK() }; };
  const resize = () => {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 3);
    w = Math.max(1, r.width); h = Math.max(1, r.height); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!fitted && r.width > 10) { fit(); fitted = true; }
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const toWorld = (sx: number, sy: number) => ({ x: (sx - w / 2) / cam.k + cam.x, y: (sy - h / 2) / cam.k + cam.y });
  const toScreen = (x: number, y: number) => ({ x: w / 2 + (x - cam.x) * cam.k, y: h / 2 + (y - cam.y) * cam.k });

  const mk = (key: string, kind: Kind, p: Partial<N>): N => ({ key, kind, id: 0, chatId: 0, grp: "", text: "", size: 0, at: "", x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, born: 0, hue: 0, visible: true, ...p });

  function rebuild() {
    const keep = new Set<string>(["core"]);
    if (!nodes.has("core")) nodes.set("core", mk("core", "core", { text: "Yaeori" }));
    // группы: чаты или дни
    interface G { key: string; label: string; count: number; chatId: number }
    const groups: G[] = [];
    if (o.group === "chat") for (const c of data.chats) groups.push({ key: "c" + c.id, label: c.title, count: c.count, chatId: c.id });
    else {
      const byDay = new Map<string, G>();
      for (const m of data.messages) { if (m.tier !== undefined) continue; const k = "d" + dayKey(m.at), g = byDay.get(k) ?? { key: k, label: dayLabel(k.slice(1)), count: 0, chatId: m.chatId }; g.count++; g.chatId = m.chatId; byDay.set(k, g); }
      groups.push(...[...byDay.values()].slice(-12));
      for (const c of data.chats) if (c.id >= AREA_OFF) groups.push({ key: "c" + c.id, label: c.title, count: c.count, chatId: c.id });
    }
    const gKey = (m: GraphData["messages"][number]) => (o.group === "chat" || m.tier !== undefined ? "c" + m.chatId : "d" + dayKey(m.at));
    groups.forEach((g, i) => {
      keep.add("h" + g.key);
      let n = nodes.get("h" + g.key);
      if (!n) { const a = (i / Math.max(groups.length, 1)) * TAU; n = mk("h" + g.key, "hub", { grp: g.key, x: Math.cos(a) * 40, y: Math.sin(a) * 40 }); nodes.set(n.key, n); }
      Object.assign(n, { text: g.label, size: g.count, hue: i, chatId: g.chatId, id: g.chatId });
    });
    const lastOf = new Map<string, number>();
    for (const m of data.messages) lastOf.set(gKey(m), m.id);
    for (const m of data.messages) {
      const grp = gKey(m), hub = nodes.get("h" + grp); if (!hub) continue;
      keep.add("m" + m.id);
      let n = nodes.get("m" + m.id);
      if (!n) { n = mk("m" + m.id, "msg", { id: m.id, x: hub.x + (Math.random() - .5) * 20, y: hub.y + (Math.random() - .5) * 20 }); nodes.set(n.key, n); }
      Object.assign(n, { chatId: m.chatId, grp, role: m.role, text: m.preview, size: m.size, at: m.at, hue: hub.hue, tier: m.tier, hits: m.hits, src: m.src, key2: m.tier !== undefined ? m.tier === "long" : (m.role === "assistant" && m.size > 350) || lastOf.get(grp) === m.id });
    }
    sysItems.forEach((s, i) => { const key = "s" + s.id; keep.add(key); let n = nodes.get(key); if (!n) { n = mk(key, "sys", { x: 0, y: 0 }); nodes.set(key, n); } Object.assign(n, { sys: s, text: s.label, hue: i }); });
    for (const k of [...nodes.keys()]) if (!keep.has(k)) nodes.delete(k);
    order = [...nodes.values()];
  }

  const msgsOf = (grp: string) => order.filter((n) => n.kind === "msg" && n.grp === grp);
  const radius = (n: N) => o.layout === "sectors" && n.kind === "msg" ? (neu(n) ? 1.5 + Math.min(n.hits ?? 1, 10) * 0.12 : 1.5) * dotK * o.size * (n.key2 ? 1.7 : 1) : o.layout === "sectors" && n.kind === "hub" ? 3 * dotK * o.size : n.kind === "msg" && neu(n) ? (4.2 + Math.min(n.hits ?? 1, 12) * 0.75) * o.size * (n.key2 ? 1.2 : 1) : n.kind === "core" ? 26 : n.kind === "sys" ? (n.sys?.group === "chat" ? 8.5 : 14) : n.kind === "hub" ? (8 + Math.sqrt(n.size) * 0.9) * o.size : (n.key2 ? 4.6 : 2.7 + Math.min(Math.log10(n.size + 1), 3) * 0.5) * o.size;

  let sectors: { a0: number; a1: number; hue: number }[] = [], slots: { x: number; y: number; hue: number }[] = [], dotK = 1;
  function targets() { layoutTargets(); if (o.layout !== "force") placeChips(); }
  function placeChips() {
    const chips = order.filter((n) => n.kind === "sys" && n.sys?.group === "chat"); if (!chips.length) return;
    const best = new Map<number, Map<number, number>>();
    for (const m of data.messages) if (m.src && m.tier !== undefined) { const c = best.get(m.src) ?? new Map<number, number>(); c.set(m.chatId, (c.get(m.chatId) ?? 0) + 1); best.set(m.src, c); }
    const byHub = new Map<string, N[]>();
    for (const ch of chips) {
      const cid = ch.sys!.chatId ?? 0, c = best.get(cid); let key = "hc" + cid, top = 0;
      if (c) for (const [a, k] of c) if (k > top && nodes.has("hc" + a)) { top = k; key = "hc" + a; }
      if (!nodes.has(key)) key = order.find((n) => n.kind === "hub")?.key ?? "";
      ch.grp = key; (byHub.get(key) ?? byHub.set(key, []).get(key)!).push(ch);
    }
    const pitch = 21, per = 7;
    for (const [key, list] of byHub) {
      const hb = nodes.get(key), base = hb ? Math.atan2(hb.ty, hb.tx) : 1.5708;
      list.forEach((ch, i) => { const row = Math.floor(i / per), col = i % per, n = Math.min(per, list.length - row * per), rr = R * 1.2 + row * pitch, aa = base + (col - (n - 1) / 2) * (pitch / rr) * (row % 2 ? 1 : 1); ch.tx = Math.cos(aa) * rr; ch.ty = Math.sin(aa) * rr; });
    }
  }
  function layoutTargets() {
    const hubs = order.filter((n) => n.kind === "hub"), collapsed = new Set(o.collapsed);
    for (const n of order) n.visible = n.kind !== "msg" || !collapsed.has("h" + n.grp);
    const allSys = order.filter((n) => n.kind === "sys"), sys = allSys.filter((n) => n.sys?.group !== "chat"), chips = allSys.filter((n) => n.sys?.group === "chat");
    if (o.layout === "force") chips.forEach((sn, i) => { const a = (i / Math.max(chips.length, 1)) * TAU + rot, rr = R * 1.22; sn.tx = Math.cos(a) * rr; sn.ty = Math.sin(a) * rr; sn.x = sn.tx; sn.y = sn.ty; });
    sys.forEach((sn, i) => { const a = (i / Math.max(sys.length, 1)) * TAU - 1.5708 - rot * 0.6, rr = R * 1.08; sn.tx = Math.cos(a) * rr; sn.ty = Math.sin(a) * rr; if (o.layout === "force") { sn.x = sn.tx; sn.y = sn.ty; } });
    if (o.layout === "force") return;
    const core = nodes.get("core")!;
    if (o.layout === "sectors") {
      core.tx = 0; core.ty = 0; slots = [];
      // клин на тему: шаг сетки одинаков, ширина — по числу воспоминаний, глубина — сколько нужно
      const items = hubs.map((hb) => { const off = collapsed.has(hb.key), ms = off ? [] : msgsOf(hb.grp).sort((x, y) => Date.parse(x.at) - Date.parse(y.at)); return { hb, ms, cap: off ? 0 : Math.max(12, Math.ceil((ms.length * 1.4) / 4) * 4 + 4) }; });
      const wts = items.map((i) => Math.pow(i.cap, 0.72)), wsum = wts.reduce((t, x) => t + x, 0) || 1, gapA = 0.13, usable = TAU - gapA * items.length, rin = R * 0.46, rout = R * 0.92;
      const spans = wts.map((x) => (usable * x) / wsum);
      const colsOf = (span: number, g: number) => Math.max(1, Math.floor((span * rin) / g)), depth = (g: number) => items.reduce((mx, it, i) => Math.max(mx, rin + Math.ceil(it.cap / colsOf(spans[i]!, g)) * g), 0);
      let g = 6; for (const c of [30, 26, 22, 19, 16, 14, 12, 10, 9, 8, 7]) if (depth(c) <= rout) { g = c; break; }
      dotK = Math.max(1, Math.min(2.8, g / 9));
      let at = -1.5708 + rot;
      items.forEach((it, i) => {
        const a0 = at + gapA / 2, a1 = a0 + spans[i]!; at += spans[i]! + gapA;
        let r = rin, k = 0, last = rin; const cols = colsOf(spans[i]!, g);
        while (k < it.cap) {
          const n = Math.min(cols, it.cap - k);
          for (let c = 0; c < n; c++) { const aa = a0 + ((c + 0.5) / cols) * (a1 - a0), x = Math.cos(aa) * r, y = Math.sin(aa) * r, m = it.ms[k + c]; if (m) { m.tx = x; m.ty = y; } else slots.push({ x, y, hue: it.hb.hue }); }
          k += n; last = r; r += g;
        }
        const mid = (a0 + a1) / 2, hr = Math.min(last + 14 + 4 * dotK, R * 1.0); it.hb.tx = Math.cos(mid) * hr; it.hb.ty = Math.sin(mid) * hr;
      });
    } else if (o.layout === "rings") {
      const tot = order.filter((n) => n.kind === "msg" && n.visible).length, g = (order.some(neu) ? Math.max(11, 24 - tot * 0.12) : 8.5 + 8 * Math.max(0, 1 - tot / 250)) * o.size, r0 = R * (0.3 + 0.2 * Math.max(0, 1 - tot / 120)), wts = hubs.map((hb) => Math.pow(Math.max(msgsOf(hb.grp).length, 3), 0.6)), wsum = wts.reduce((x, y) => x + y, 0) || 1;
      let at = 0;
      hubs.forEach((hb, i) => {
        const share = (wts[i]! / wsum) * TAU, a0 = at - 1.5708 + rot; at += share;
        const w = share * 0.8, a = a0 + share / 2, ms = collapsed.has(hb.key) ? [] : msgsOf(hb.grp);
        let r = r0, k = 0;
        while (k < ms.length) {
          const cols = Math.max(1, Math.floor((w * r) / g)), n = Math.min(cols, ms.length - k);
          for (let c = 0; c < n; c++) { const aa = a + (n > 1 ? (c / (n - 1) - 0.5) * Math.min(w, (n - 1) * g / r) : 0); ms[k + c]!.tx = Math.cos(aa) * r; ms[k + c]!.ty = Math.sin(aa) * r; }
          k += n; r += g;
        }
        const hr = Math.min(r + 12, R * 0.92); hb.tx = Math.cos(a) * hr; hb.ty = Math.sin(a) * hr;
      });
      core.tx = 0; core.ty = 0;
    } else if (o.layout === "circle") {
      const vis = hubs.map((hb) => (collapsed.has(hb.key) ? [] : msgsOf(hb.grp))), total = vis.reduce((s, v) => s + Math.max(v.length, 1), 0) || 1;
      let at = 0;
      hubs.forEach((hb, i) => {
        const cnt = Math.max(vis[i]!.length, 1), arc = (cnt / total) * TAU, a0 = at - 1.5708 + rot; at += arc;
        const mid = a0 + arc / 2; hb.tx = Math.cos(mid) * R * 0.62; hb.ty = Math.sin(mid) * R * 0.62;
        vis[i]!.forEach((m, j) => { const aa = a0 + ((j + 0.5) / cnt) * arc; m.tx = Math.cos(aa) * R; m.ty = Math.sin(aa) * R; });
      });
      core.tx = 0; core.ty = 0;
    } else if (o.layout === "tile") {
      core.tx = 0; core.ty = 0;
      hubs.forEach((hb, i) => {
        const [gx, gy] = tileCell(i + 1), cx = gx * TILE, cy = gy * TILE; hb.tx = cx; hb.ty = cy - TILE * 0.3;
        const ms = collapsed.has(hb.key) ? [] : msgsOf(hb.grp), cols = Math.max(4, Math.min(9, Math.ceil(Math.sqrt(ms.length * 1.6)))), gap = Math.min(15, (TILE * 0.78) / cols);
        ms.forEach((m, j) => { const row = Math.floor(j / cols), col = j % cols, inRow = Math.min(cols, ms.length - row * cols); m.tx = cx + (col - (inRow - 1) / 2) * gap; m.ty = cy - TILE * 0.06 + row * gap; });
      });
    } else if (o.layout === "hud") {
      core.tx = 0; core.ty = 0; sectors = [];
      const vis = hubs.map((hb) => (collapsed.has(hb.key) ? [] : msgsOf(hb.grp))), total = vis.reduce((a, v) => a + Math.max(v.length, 2), 0) || 1;
      let at = 0;
      hubs.forEach((hb, i) => {
        const cnt = vis[i]!.length, arc = (Math.max(cnt, 2) / total) * TAU, a0 = at - 1.5708 + rot; at += arc;
        const mid = a0 + arc / 2; sectors.push({ a0, a1: a0 + arc, hue: hb.hue }); hb.tx = Math.cos(mid) * R * 0.42; hb.ty = Math.sin(mid) * R * 0.42;
        vis[i]!.forEach((m, j) => { const aa = a0 + arc * (0.2 + 0.6 * ((j % 3) + 0.5) / 3), rr = R * (0.58 + 0.42 * (j + 0.5) / cnt); m.tx = Math.cos(aa) * rr; m.ty = Math.sin(aa) * rr; });
      });
    } else {
      const s = 105, pos = (i: number) => { const [q, r] = hexCell(i); return { x: s * Math.sqrt(3) * (q + r / 2), y: s * 1.5 * r }; };
      core.tx = 0; core.ty = 0;
      hubs.forEach((hb, i) => {
        const p = pos(i + 1); hb.tx = p.x; hb.ty = p.y;
        (collapsed.has(hb.key) ? [] : msgsOf(hb.grp)).forEach((m, j) => { const rr = Math.min(s * 0.82, 20 + Math.sqrt(j + 1) * 13), aa = j * 2.4 + rot; m.tx = p.x + Math.cos(aa) * rr; m.ty = p.y + Math.sin(aa) * rr; });
      });
    }
  }

  function physics() {
    const hubs = order.filter((n) => n.kind === "hub"), k = 0.02 + o.force * 0.08;
    for (let i = 0; i < hubs.length; i++) {
      const a = hubs[i]!;
      for (let j = i + 1; j < hubs.length; j++) { const b = hubs[j]!; let dx = a.x - b.x, dy = a.y - b.y; const d2 = Math.max(dx * dx + dy * dy, 400), d = Math.sqrt(d2), f = 9000 / d2; dx /= d; dy /= d; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
      const d = Math.hypot(a.x, a.y) || 1, f = (d - R * 0.5) * 0.012; a.vx -= (a.x / d) * f; a.vy -= (a.y / d) * f;
    }
    const vis = order.filter((n) => n.kind === "msg" && n.visible);
    for (const m of vis) {
      const hb = nodes.get("h" + m.grp); if (!hb) continue;
      const dx = m.x - hb.x, dy = m.y - hb.y, d = Math.hypot(dx, dy) || 1, f = (d - 36) * k; m.vx -= (dx / d) * f; m.vy -= (dy / d) * f; hb.vx += (dx / d) * f * 0.1; hb.vy += (dy / d) * f * 0.1;
    }
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i]!, b = vis[j]!, dx = a.x - b.x, dy = a.y - b.y; if (Math.abs(dx) > 22 || Math.abs(dy) > 22) continue;
      const d = Math.hypot(dx, dy) || 1; if (d >= 22) continue; const f = (22 - d) * 0.05; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of order) { if (n.kind === "core") { n.x = 0; n.y = 0; continue; } if (n.kind === "sys") continue; n.vx *= 0.82; n.vy *= 0.82; n.x += Math.max(-12, Math.min(12, n.vx)); n.y += Math.max(-12, Math.min(12, n.vy)); }
  }

  const matches = (n: N) => !query || n.text.toLowerCase().includes(query);
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - last, 50); last = now;
    if (!still) rot += dt * o.rotation * 0.0002;
    if (now - palAt > 1000) { pal = palette(o.theme); palAt = now; }
    if (camGoal) { cam.x += (camGoal.x - cam.x) * 0.16; cam.y += (camGoal.y - cam.y) * 0.16; cam.k += (camGoal.k - cam.k) * 0.16; if (Math.abs(camGoal.x - cam.x) + Math.abs(camGoal.y - cam.y) < 0.4 && Math.abs(camGoal.k - cam.k) < 0.01) camGoal = null; }
    targets();
    if (o.layout === "force") physics(); else for (const n of order) { n.x += (n.tx - n.x) * 0.14; n.y += (n.ty - n.y) * 0.14; }
    if (tour.on) {
      const hubs = order.filter((n) => n.kind === "hub");
      if (!hubs.length) { tour.on = false; cb.onShowEnd?.(); }
      else {
        if (now - tour.at > 4200) { tour.at = now; tour.i++; if (tour.i > hubs.length) { tour.on = false; cb.onShowEnd?.(); } }
        const hb = hubs[tour.i];
        const to = hb && tour.i >= 0 ? { x: hb.x, y: hb.y, k: Math.max(fitK() * 2.6, 1.4) } : { x: 0, y: 0, k: fitK() };
        cam.x += (to.x - cam.x) * 0.05; cam.y += (to.y - cam.y) * 0.05; cam.k += (to.k - cam.k) * 0.05;
      }
    }
    draw(now);
  }

  function draw(now: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = "round";
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, h);
    const hubs = order.filter((n) => n.kind === "hub"), core = nodes.get("core")!, hue = (n: N) => pal.hubs[n.hue % pal.hubs.length]!, byKey = nodes;
    // фон: едва заметная сетка из шестиугольников
    const hs = 46 * cam.k;
    if (o.layout === "sectors") { // спокойный фон: мягкое свечение у центра вместо сетки
      if (/^#[0-9a-f]{6}$/i.test(pal.hubs[0]!)) { const cc = toScreen(core.x, core.y), gg = ctx.createRadialGradient(cc.x, cc.y, 0, cc.x, cc.y, R * 1.15 * cam.k); gg.addColorStop(0, pal.hubs[0]! + "26"); gg.addColorStop(0.6, pal.hubs[0]! + "0d"); gg.addColorStop(1, pal.hubs[0]! + "00");
      ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h); }
    } else if (hs > 12) {
      ctx.strokeStyle = pal.line; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.beginPath();
      const hw = hs * Math.sqrt(3), ox = (w / 2 - cam.x * cam.k) % hw, oy = (h / 2 - cam.y * cam.k) % (hs * 1.5);
      for (let row = -2, y = oy - hs * 3; y < h + hs; row++, y += hs * 1.5) for (let x = ox - hw * 2 + (row % 2 ? hw / 2 : 0); x < w + hw; x += hw) {
        for (let v = 0; v < 3; v++) { const a = Math.PI / 6 + v * Math.PI / 3; ctx.moveTo(x + Math.cos(a) * hs, y + Math.sin(a) * hs); ctx.lineTo(x + Math.cos(a + Math.PI / 3) * hs, y + Math.sin(a + Math.PI / 3) * hs); }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // круги-ориентиры
    const c0 = toScreen(core.x, core.y);
    ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
    for (const rr of [R * 0.28, R * 0.58, R * 0.85, R * 1.08]) { ctx.globalAlpha = o.layout === "sectors" ? (rr === R * 1.08 ? 0.5 : 0.22) : rr === R * 1.08 ? 0.9 : 0.55; ctx.beginPath(); ctx.arc(c0.x, c0.y, rr * cam.k, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (o.layout === "sectors") { // свободные ячейки секторов: растут и заполняются
      const sr = Math.max(0.9, 1.35 * dotK * cam.k);
      for (const sl of slots) { const q = toScreen(sl.x, sl.y); ctx.fillStyle = pal.hubs[sl.hue % pal.hubs.length]!; ctx.globalAlpha = 0.17; ctx.beginPath(); ctx.arc(q.x, q.y, sr, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // соты-ячейки
    if (o.layout === "hex") {
      const s = 105;
      [core, ...hubs].forEach((cn, i) => {
        ctx.beginPath();
        for (let v = 0; v < 6; v++) { const a = Math.PI / 6 + v * Math.PI / 3, p = toScreen(cn.x + Math.cos(a) * s * 0.98, cn.y + Math.sin(a) * s * 0.98); v ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.closePath(); const col = i === 0 ? pal.muted : hue(cn);
        ctx.globalAlpha = 0.06; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = (cn.chatId === selected && i) ? 0.9 : 0.35; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    // плита: прямоугольные карточки чатов
    if (o.layout === "tile") {
      hubs.forEach((hb) => {
        const cx = hb.x, cy = hb.y + TILE * 0.3, a = toScreen(cx - TILE / 2 + 3, cy - TILE / 2 + 3), col = hue(hb), sz = (TILE - 6) * cam.k;
        ctx.beginPath(); ctx.roundRect(a.x, a.y, sz, sz, 8 * cam.k); ctx.globalAlpha = 0.07; ctx.fillStyle = col; ctx.fill();
        ctx.globalAlpha = hb.chatId === selected ? 0.9 : 0.35; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    // HUD: секторы, шкала, прицел и луч
    if (o.layout === "hud") {
      const ring = R * cam.k, col = pal.muted;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      for (let d = 0; d < 360; d += 6) { const a = d * Math.PI / 180, long = d % 30 === 0, r0 = ring * (long ? 1.0 : 1.03), r1 = ring * 1.06; ctx.beginPath(); ctx.moveTo(c0.x + Math.cos(a) * r0, c0.y + Math.sin(a) * r0); ctx.lineTo(c0.x + Math.cos(a) * r1, c0.y + Math.sin(a) * r1); ctx.stroke(); }
      for (const sc of sectors) { ctx.strokeStyle = pal.hubs[sc.hue % pal.hubs.length]!; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(c0.x + Math.cos(sc.a0) * ring * 0.3, c0.y + Math.sin(sc.a0) * ring * 0.3); ctx.lineTo(c0.x + Math.cos(sc.a0) * ring, c0.y + Math.sin(sc.a0) * ring); ctx.stroke(); }
      const sw = still ? -1.5708 : now * 0.0006 % TAU, g = ctx.createLinearGradient(c0.x, c0.y, c0.x + Math.cos(sw) * ring, c0.y + Math.sin(sw) * ring);
      g.addColorStop(0, "transparent"); g.addColorStop(1, pal.hubs[0]!); ctx.strokeStyle = g; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c0.x + Math.cos(sw) * ring, c0.y + Math.sin(sw) * ring); ctx.stroke();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5; const b = 18;
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) { const x = sx ? w - 10 : 10, y = sy ? h - 10 : 10, dx = sx ? -b : b, dy = sy ? -b : b; ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    // наведение: что подсвечивать
    hover = null;
    if (mouse && !drag?.moved) { const wp = toWorld(mouse.x, mouse.y); let best = 1e9; for (const n of order) { if (!n.visible || n.kind === "core") continue; const d = Math.hypot(n.x - wp.x, n.y - wp.y), lim = (radius(n) + 5) / Math.max(cam.k, 0.6); if (d < lim && d < best) { best = d; hover = n; } } }
    const hl = hover?.kind === "hub" ? hover.grp : hover?.kind === "msg" ? hover.grp : null;
    const dimOf = (n: N) => (query && !matches(n) ? 0.15 : pin && n.kind === "msg" && !pin.has(n.key) && !pinNb.has(n.key) ? 0.22 : selected !== null && n.chatId !== selected && n.src !== selected && o.layout !== "force" ? 0.4 : 1);
    // лучи от значков системы к центру
    for (const sn of order) {
      if (sn.kind !== "sys") continue; const p = toScreen(sn.x, sn.y), on = hover === sn;
      const g = ctx.createLinearGradient(p.x, p.y, c0.x, c0.y); g.addColorStop(0, on ? pal.text : pal.muted); g.addColorStop(1, "transparent");
      ctx.strokeStyle = g; ctx.globalAlpha = on ? 0.7 : 0.22; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c0.x, c0.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // связи: центр → отделы
    for (const hb of hubs) {
      const p = toScreen(hb.x, hb.y), on = hb.chatId === selected || hl === hb.grp;
      const g = ctx.createLinearGradient(c0.x, c0.y, p.x, p.y); g.addColorStop(0, "transparent"); g.addColorStop(0.35, pal.line); g.addColorStop(1, on ? hue(hb) : pal.line);
      ctx.strokeStyle = g; ctx.globalAlpha = on ? 0.95 : o.layout === "sectors" ? 0.5 : 0.8; ctx.lineWidth = on ? 1.6 : 1; ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    // лучи: отдел → сообщения (затухают с расстоянием)
    for (const m of order) {
      if (m.kind !== "msg" || !m.visible) continue;
      const hb = byKey.get("h" + m.grp); if (!hb) continue;
      const a = toScreen(hb.x, hb.y), b = toScreen(m.x, m.y), on = hb.chatId === selected || hl === m.grp;
      if (o.layout === "sectors" && !on) continue;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, on ? hue(hb) : pal.line); g.addColorStop(1, "transparent");
      ctx.strokeStyle = g; ctx.globalAlpha = (on ? 0.8 : 0.5) * dimOf(m); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // нейрон помнит, из какой беседы он пришёл
    if (o.group === "chat" && o.links) for (const m of order) {
      if (m.kind !== "msg" || !m.visible || !neu(m) || !m.src) continue;
      const hb = byKey.get("hc" + m.src); if (!hb || !hb.visible) continue;
      const pa = toScreen(hb.x, hb.y), pb = toScreen(m.x, m.y), on = hover === m || hover === hb || (pin !== null && pin.has(m.key));
      if (o.layout === "sectors" && !on) continue;
      ctx.setLineDash([3, 4]); ctx.strokeStyle = on ? pal.text : pal.muted; ctx.globalAlpha = (on ? 0.8 : 0.1) * dimOf(m); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // связи между чатами: общие слова
    if (o.links) for (const l of data.links) {
      const a = byKey.get("m" + l.a), b = byKey.get("m" + l.b); if (!a || !b || !a.visible || !b.visible) continue;
      const lk = l.kinds?.length ? l.kinds : ["topic"]; if (!lk.some((k) => linkKinds.has(k))) continue;
      const on = (pin && (pin.has(a.key) || pin.has(b.key))) || hover && (hover.key === a.key || hover.key === b.key || (hover.kind === "hub" && (a.chatId === hover.chatId || b.chatId === hover.chatId)));
      if (o.layout === "sectors" && !on) continue;
      if (hover && !on && (hover.kind === "msg" || hover.kind === "hub")) continue;
      const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y), mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      ctx.strokeStyle = on ? pal.text : pal.muted; const nl = neu(a), sem = lk.includes("sense"), ent = !sem && lk.includes("entity"), cht = !sem && !ent && lk.includes("chat"); if (ent) { ctx.setLineDash([6, 3]); if (!on) ctx.strokeStyle = pal.hubs[3] ?? pal.hubs[0]!; } else if (sem) { ctx.setLineDash([2, 4]); if (!on) ctx.strokeStyle = pal.hubs[2]!; } else if (cht) { ctx.setLineDash([1, 4]); if (!on) ctx.strokeStyle = pal.hubs[1]!; } ctx.globalAlpha = (on ? 0.9 : nl ? 0.24 : 0.16) * Math.min(1, 0.5 + l.w * 0.25); ctx.lineWidth = (on ? 1.4 : 1) + (nl ? Math.min(2.2, (l.w - 1) * 0.7) : 0);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); const bend = nl ? 0.12 : 0.35; ctx.quadraticCurveTo(mx + (c0.x - mx) * bend, my + (c0.y - my) * bend, pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    // центр: двойное кольцо и знак
    const cr = 26 * cam.k, pulse = still ? 0 : Math.sin(now * 0.002) * 2 * cam.k;
    ctx.fillStyle = pal.hubs[0]!; ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr * 1.7 + pulse, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.5;
    ctx.strokeStyle = pal.hubs[0]!; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr * 1.35, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 2;
    ctx.fillStyle = pal.bg; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = pal.text; ctx.lineWidth = Math.max(1.2, 1.6 * cam.k); ctx.beginPath(); ctx.arc(c0.x - cr * 0.16, c0.y + cr * 0.06, cr * 0.42, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(c0.x + cr * 0.16, c0.y - cr * 0.06, cr * 0.42, 0, TAU); ctx.stroke();
    ctx.fillStyle = pal.text; ctx.font = `600 ${Math.max(9, Math.min(13, 11 * cam.k))}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; if (o.layout !== "tile") ctx.fillText("YAEORI", c0.x, c0.y + cr * 1.5 + 6);
    // подписи узлов без наложений: сначала важные (наведённые, выбранные, отделы по размеру), остальные пропускаем, если место занято
    const placed: [number, number, number, number][] = [], labelOk = new Set<string>();
    const tryPlace = (x0: number, y0: number, wd: number, ht: number) => { for (const q of placed) if (x0 < q[0] + q[2] && x0 + wd > q[0] && y0 < q[1] + q[3] && y0 + ht > q[1]) return false; placed.push([x0, y0, wd, ht]); return true; };
    const hubLabel = (n: N) => { const lim = o.layout === "tile" ? 12 : 22; return (n.text.length > lim ? n.text.slice(0, lim - 1) + "…" : n.text) + (o.collapsed.includes(n.key) ? `  +${n.size}` : ""); };
    ctx.textRendering = "optimizeLegibility";
    for (const n of order.filter((x) => x.kind === "hub" && x.visible).sort((a, b) => Number(b === hover) - Number(a === hover) || Number(b.chatId === selected) - Number(a.chatId === selected) || Number(isArea(b)) - Number(isArea(a)) || b.size - a.size)) {
      const p = toScreen(n.x, n.y), r = Math.max(3, radius(n) * cam.k); ctx.font = `${isArea(n) ? 600 : 500} ${isArea(n) ? 12.5 : 11}px ${SANS}`;
      const t = hubLabel(n), wd = ctx.measureText(t).width + 8;
      if (tryPlace(p.x - wd / 2, p.y - r - 8 - 16, wd, 16) || n === hover || n.chatId === selected) labelOk.add(n.key);
    }
    // узлы
    for (const n of order) {
      if (n.kind === "core" || !n.visible) continue;
      const p = toScreen(n.x, n.y); if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      const r = Math.max(n.kind === "msg" ? 1.6 : 3, radius(n) * cam.k) + (n === hover ? 2 : 0), hit = !query || matches(n), dim = dimOf(n);
      const age = n.born ? (now - n.born) / 900 : 1;
      if (age < 1) { ctx.globalAlpha = 1 - age; ctx.strokeStyle = pal.user; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + age * 24, 0, TAU); ctx.stroke(); }
      if (n.kind === "sys") {
        const s = n.sys!, hb0 = s.group === "chat" ? nodes.get(n.grp) : null, col = hb0 ? hue(hb0) : s.ok ? pal.hubs[0]! : pal.warn;
        if (hb0 && hb0.visible) { const q = toScreen(hb0.x, hb0.y); ctx.strokeStyle = col; ctx.globalAlpha = s.on || n === hover ? 0.7 : 0.12; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        ctx.globalAlpha = dim; ctx.fillStyle = pal.bg; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = n === hover || n.sys!.on ? 2.4 : 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
        ctx.save(); ctx.translate(p.x - r * 0.55, p.y - r * 0.55); ctx.scale((r * 1.1) / 24, (r * 1.1) / 24); ctx.strokeStyle = col; ctx.lineWidth = 2 / ((r * 1.1) / 24) * 0.9; ctx.stroke(PATHS[s.icon]); ctx.restore();
        ctx.globalAlpha = 1; continue;
      }
      const fade = n.tier === "fading" ? 0.45 : 1;
      ctx.globalAlpha = dim * fade; ctx.fillStyle = n.kind === "hub" ? hue(n) : n.tier === "fading" ? pal.muted : hue(n);
      if (n.kind === "msg" && !n.key2 && o.layout !== "sectors") { const tw = still ? 1 : 0.88 + Math.sin(now * 0.002 + n.id * 1.7) * 0.12; ctx.globalAlpha = dim * fade * tw; ctx.fillRect(p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6); }
      else if (n.kind === "hub" && !isArea(n)) { ctx.beginPath(); ctx.roundRect(p.x - r, p.y - r, r * 2, r * 2, r * 0.35); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); }
      if (neu(n) && n.tier === "fresh" && !still) { ctx.globalAlpha = dim * (0.1 + 0.08 * Math.sin(now * 0.004 + n.id)); ctx.fillStyle = hue(n); ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, TAU); ctx.fill(); ctx.globalAlpha = dim * fade; }
      // свечение у ключевых, выбранных, найденных и наведённых
      if (n.kind === "hub" || n === hover || pin?.has(n.key) || (n.kind === "msg" && n.key2 && (o.layout !== "sectors" && neu(n) || n.chatId === selected)) || (n.tier === "fresh" && o.layout !== "sectors") || (query && hit)) {
        ctx.globalAlpha = n === hover ? 0.55 : 0.28; ctx.strokeStyle = n.kind === "hub" ? hue(n) : (query && hit) ? pal.text : ctx.fillStyle as string; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 + (still ? 0 : Math.sin(now * 0.003) * 1.2), 0, TAU); ctx.stroke();
        if (n === hover) { ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, 0, TAU); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      if (n.kind === "hub") {
        if (labelOk.has(n.key)) {
          const t = hubLabel(n); ctx.font = `${isArea(n) ? 600 : 500} ${isArea(n) ? 12.5 : 11}px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = pal.bg;
          ctx.globalAlpha = (query && !hit ? 0.3 : 1) * (isArea(n) ? 1 : 0.82); ctx.strokeText(t, p.x, p.y - r - 8); ctx.fillStyle = hue(n); ctx.fillText(t, p.x, p.y - r - 8); ctx.globalAlpha = 1;
        }
      } else if (n.kind === "msg" && (o.labels || n.key2) && cam.k > 1.3) {
        ctx.font = `500 11px ${SANS}`; ctx.fillStyle = pal.muted; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.globalAlpha = dim; ctx.fillText((n.text.split(/\s+/)[0] ?? "").slice(0, 14), p.x + r + 4, p.y); ctx.globalAlpha = 1;
      }
    }
    // сущности: ромбик в центре тяжести своих воспоминаний; щелчок подсвечивает все его воспоминания
    entHover = null;
    if (linkKinds.has("entity") && ents.length) {
      const pts: { e: EntityInfo; x: number; y: number; ns: N[] }[] = [];
      for (const e of ents) { const ns = e.memories.map((id) => nodes.get("m" + (NEURON_OFF + id))).filter((x): x is N => !!x && x.visible); if (ns.length < 2) continue; const q = toScreen(ns.reduce((a, x) => a + x.x, 0) / ns.length, ns.reduce((a, x) => a + x.y, 0) / ns.length); pts.push({ e, x: q.x, y: q.y, ns }); }
      pts.sort((a, b) => b.ns.length - a.ns.length); const shown = pts.filter((x, i) => i < 14 || x.e.id === entSel);
      if (mouse && !drag?.moved) for (const x of shown) if (Math.hypot(x.x - mouse.x, x.y - mouse.y) < 10) entHover = x.e.id;
      const ec = pal.hubs[3] ?? pal.hubs[0]!;
      shown.forEach((x, i) => {
        const sel = x.e.id === entSel, hov = x.e.id === entHover;
        if (sel || hov) { ctx.strokeStyle = ec; ctx.globalAlpha = sel ? 0.7 : 0.4; ctx.lineWidth = 1.2; ctx.setLineDash([5, 3]); ctx.beginPath(); for (const nn of x.ns) { const q = toScreen(nn.x, nn.y); ctx.moveTo(x.x, x.y); ctx.lineTo(q.x, q.y); } ctx.stroke(); ctx.setLineDash([]); }
        const r = sel || hov ? 7.5 : 5.5; ctx.globalAlpha = 1; ctx.fillStyle = ec; ctx.strokeStyle = pal.bg; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x.x, x.y - r); ctx.lineTo(x.x + r, x.y); ctx.lineTo(x.x, x.y + r); ctx.lineTo(x.x - r, x.y); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (i < 8 || sel || hov) { ctx.font = `600 11px ${SANS}`; const wd = ctx.measureText(x.e.name).width + 6; if (sel || hov || tryPlace(x.x + r + 2, x.y - 8, wd, 16)) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = pal.bg; ctx.fillStyle = pal.text; ctx.strokeText(x.e.name, x.x + r + 4, x.y); ctx.fillText(x.e.name, x.x + r + 4, x.y); } }
      });
      ctx.globalAlpha = 1;
    }
    // импульсы мысли: сообщение → мозг → память → ответ
    if (!still && thinking && now - lastThink > 1100) { lastThink = now; rings.push({ key: "core", t0: now, col: "accent" }); }
    const colOf = (c: Col) => (c === "user" ? pal.user : c === "bot" ? pal.bot : c === "gold" ? "#ffc857" : c === "mint" ? "#5eead4" : pal.hubs[0]!), dark = ((parseInt(pal.bg.slice(1, 3), 16) || 0) + (parseInt(pal.bg.slice(3, 5), 16) || 0) + (parseInt(pal.bg.slice(5, 7), 16) || 0)) < 330;
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i]!, age = (now - rg.t0) / 900, nd = nodes.get(rg.key);
      if (age >= 1) { rings.splice(i, 1); continue; } if (age < 0 || !nd || !nd.visible) continue;
      const q = toScreen(nd.x, nd.y), rr = Math.max(6, radius(nd) * cam.k) + age * 34 * Math.max(0.7, cam.k);
      ctx.strokeStyle = colOf(rg.col); ctx.globalAlpha = (1 - age) * 0.8; ctx.lineWidth = 2.2 * (1 - age) + 0.6; ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, TAU); ctx.stroke();
      if (rg.burst) { // вспышка с лучами: рождение или закрепление воспоминания
        const r0 = Math.max(6, radius(nd) * cam.k) + 2; ctx.lineWidth = 1.6; ctx.globalAlpha = (1 - age) * 0.9; ctx.beginPath();
        for (let a = 0; a < 10; a++) { const an = (a / 10) * TAU + 0.3, r1 = r0 + age * 20, r2 = r1 + 5 + (1 - age) * 7; ctx.moveTo(q.x + Math.cos(an) * r1, q.y + Math.sin(an) * r1); ctx.lineTo(q.x + Math.cos(an) * r2, q.y + Math.sin(an) * r2); }
        ctx.stroke(); ctx.globalAlpha = (1 - age) * 0.25; ctx.fillStyle = colOf(rg.col); ctx.beginPath(); ctx.arc(q.x, q.y, r0 + age * 10, 0, TAU); ctx.fill();
      }
    }
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i]!, t = (now - f.t0) / f.dur; if (t >= 1) { fxs.splice(i, 1); continue; } if (t < 0) continue;
      const pts = f.keys.map((k) => nodes.get(k)).filter((n): n is N => !!n && (n.visible || n.kind !== "msg")).map((n) => toScreen(n.x, n.y));
      if (pts.length < 2) { fxs.splice(i, 1); continue; }
      const lens = pts.slice(1).map((q, j) => Math.hypot(q.x - pts[j]!.x, q.y - pts[j]!.y)), tot = lens.reduce((x, y) => x + y, 0) || 1;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, at = (d: number) => { let r = Math.max(0, Math.min(tot, d)); for (let j = 0; j < lens.length; j++) { if (r <= lens[j]!) { const u = lens[j]! ? r / lens[j]! : 0; return { x: pts[j]!.x + (pts[j + 1]!.x - pts[j]!.x) * u, y: pts[j]!.y + (pts[j + 1]!.y - pts[j]!.y) * u, seg: j }; } r -= lens[j]!; } return { x: pts[pts.length - 1]!.x, y: pts[pts.length - 1]!.y, seg: lens.length - 1 }; };
      const head = at(e * tot), col = colOf(f.col);
      while (f.reached < head.seg) { f.reached++; const key = f.keys[f.reached]; if (key) rings.push({ key, t0: now, col: f.col, burst: key === f.keys[f.keys.length - 1] && (f.col === "mint" || f.col === "gold") }); }
      ctx.fillStyle = col; if (dark) ctx.globalCompositeOperation = "lighter";
      const sc = Math.max(0.8, Math.min(1.5, cam.k));
      for (let j = 15; j >= 0; j--) { const q = at(e * tot - j * 6.5 * sc); ctx.globalAlpha = Math.pow(1 - j / 16, 1.6) * 0.6; ctx.beginPath(); ctx.arc(q.x, q.y, (4.6 - j * 0.24) * sc, 0, TAU); ctx.fill(); }
      const gr = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 22 * sc); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.5; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(head.x, head.y, 22 * sc, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(head.x, head.y, 4.8 * sc, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.9; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(head.x, head.y, 1.9 * sc, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = "source-over";
      if (t > 0.97 && f.reached < f.keys.length - 1) { f.reached = f.keys.length - 1; rings.push({ key: f.keys[f.reached]!, t0: now, col: f.col, burst: f.col === "mint" || f.col === "gold" }); }
    }
    ctx.globalAlpha = 1;
    // подпись системного кольца
    if (sysItems.length) { const t = toScreen(0, -R * 1.08 - 26); ctx.font = `600 10px ${SANS}`; ctx.fillStyle = pal.muted; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText("СИСТЕМА", t.x, t.y); }
    // подсказка
    if (hover) {
      const p = toScreen(hover.x, hover.y); tip.hidden = false;
      const links = hover.kind === "msg" ? data.links.filter((l) => l.a === hover!.id || l.b === hover!.id) : [];
      const words = [...new Set(links.flatMap((l) => l.words))].slice(0, 4);
      const TIERS: Record<string, string> = { fresh: "Свежая память", long: "Долгая память", fading: "Забывается", plain: "Воспоминание" };
      tip.innerHTML = hover.kind === "hub" ? `<strong></strong><small>${hover.size} ${isArea(hover) ? "воспомин." : "сообщ."}</small><span>Двойной щелчок — свернуть или развернуть</span>`
        : hover.kind === "sys" ? `<strong></strong><small></small>`
        : neu(hover) ? `<strong>${TIERS[hover.tier ?? "plain"]}</strong><small>Подтверждено ×${hover.hits ?? 1} · ${new Date(hover.at).toLocaleDateString("ru-RU")}</small><span></span>${words.length ? `<em></em>` : ""}`
        : `<strong>${hover.role === "user" ? "Вы" : "Yaeori"}</strong><small>${new Date(hover.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</small><span></span>${words.length ? `<em></em>` : ""}`;
      if (hover.kind === "hub") tip.querySelector("strong")!.textContent = hover.text;
      else if (hover.kind === "sys") { tip.querySelector("strong")!.textContent = hover.sys!.label; tip.querySelector("small")!.textContent = hover.sys!.detail; }
      else { tip.querySelector("span")!.textContent = hover.text; if (words.length) tip.querySelector("em")!.textContent = "Связано: " + words.join(", "); }
      tip.style.left = Math.min(Math.max(8, p.x + 12), Math.max(8, w - 232)) + "px"; tip.style.top = Math.min(p.y + 12, Math.max(8, h - 96)) + "px"; canvas.style.cursor = "pointer";
    } else { tip.hidden = true; canvas.style.cursor = drag ? "grabbing" : entHover !== null ? "pointer" : "grab"; }
  }
  rebuild(); raf = requestAnimationFrame(frame);

  const pos = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const stopTour = () => { if (tour.on) { tour.on = false; cb.onShowEnd?.(); } };
  canvas.addEventListener("pointerdown", (e) => { stopTour(); camGoal = null; const p = pos(e); drag = { sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { const p = pos(e); mouse = p; if (drag) { const dx = p.x - drag.sx, dy = p.y - drag.sy; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; } } });
  canvas.addEventListener("pointerup", (e) => {
    const was = drag; drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }
    if (was && !was.moved && entHover !== null) {
      const e = ents.find((x) => x.id === entHover); if (e) { entSel = entSel === e.id ? null : e.id; handle.pin(entSel === null ? [] : e.memories.map((id) => "mem:" + id)); cb.onEntity?.(entSel); }
    } else if (was && !was.moved && hover) { if (hover.kind === "sys") cb.onSystem?.(hover.sys!.id); else if (neu(hover)) { if (hover.src) cb.onPick(hover.src); } else if (!isArea(hover)) cb.onPick(hover.chatId); }
  });
  canvas.addEventListener("pointerleave", () => { mouse = null; });
  canvas.addEventListener("dblclick", () => {
    if (hover?.kind === "hub") { const k = hover.key; o = { ...o, collapsed: o.collapsed.includes(k) ? o.collapsed.filter((x) => x !== k) : [...o.collapsed, k] }; cb.onCollapse?.(o.collapsed); }
    else if (!hover) fit();
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); stopTour(); camGoal = null; const p = pos(e), before = toWorld(p.x, p.y);
    cam.k = Math.min(6, Math.max(0.2, cam.k * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(p.x, p.y); cam.x += before.x - after.x; cam.y += before.y - after.y;
  }, { passive: false });

  const handle: GraphHandle = {
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
    update(d) {
      const first = seen.size === 0; data = d; rebuild();
      for (const m of d.messages) if (!seen.has(m.id)) { seen.add(m.id); if (!first && !still) { const n = nodes.get("m" + m.id); if (n) n.born = performance.now(); } }
    },
    select(id) { selected = id; },
    flow(path, col, delay = 0) {
      const keys = resolve(path), now = performance.now();
      if (keys.length < 1) return;
      if (still || keys.length < 2) { rings.push({ key: keys[keys.length - 1]!, t0: now + delay, col, burst: col === "mint" || col === "gold" }); return; }
      const dist = keys.length * 520; fxs.push({ keys, t0: now + delay, dur: Math.min(2600, dist), col, reached: 0 });
    },
    flash(tokens, col) { const now = performance.now(); resolve(tokens).forEach((k, i) => rings.push({ key: k, t0: now + i * 60, col, burst: col === "gold" })); },
    focus(token) {
      const k = resolve([token]).pop(), n = k ? nodes.get(k) : undefined; if (!n) return; stopTour();
      if (!n.visible) { o = { ...o, collapsed: o.collapsed.filter((x) => x !== "h" + n.grp) }; cb.onCollapse?.(o.collapsed); }
      camGoal = { x: n.tx || n.x, y: n.ty || n.y, k: Math.min(6, Math.max(cam.k, fitK() * 2.2)) };
      rings.push({ key: n.key, t0: performance.now(), col: "accent" }); rings.push({ key: n.key, t0: performance.now() + 250, col: "bot" });
    },
    setLinkKinds(kinds) { linkKinds = new Set(kinds); },
    setEntities(list) { ents = list; if (entSel !== null && !list.some((e) => e.id === entSel)) entSel = null; },
    pin(tokens) {
      pinNb.clear(); if (!tokens.length) { pin = null; return; }
      const key = (t: string) => (t.startsWith("mem:") ? "m" + (NEURON_OFF + Number(t.slice(4))) : t.startsWith("chat:") ? "hc" + t.slice(5) : t);
      pin = new Set(tokens.map(key));
      for (const l of data.links) { const ka = "m" + l.a, kb = "m" + l.b; if (pin.has(ka)) pinNb.add(kb); if (pin.has(kb)) pinNb.add(ka); }
    },
    think(on) { thinking = on; lastThink = 0; },
    setOptions(p) {
      const prev = o; o = { ...o, ...p }; if (p.theme) palAt = 0;
      if (p.group && p.group !== prev.group) { o = { ...o, collapsed: [] }; nodes.clear(); rebuild(); }
      if (p.layout === "force" && prev.layout !== "force") for (const n of order) { n.vx = 0; n.vy = 0; }
    },
    options: () => o,
    setSystem(items) { sysItems = items; rebuild(); },
    expandAll() { o = { ...o, collapsed: [] }; cb.onCollapse?.(o.collapsed); },
    collapseAll() { o = { ...o, collapsed: order.filter((n) => n.kind === "hub").map((n) => n.key) }; cb.onCollapse?.(o.collapsed); },
    recenter() { stopTour(); fit(); },
    search(q) { query = q.trim().toLowerCase(); },
    png: () => new Promise((resolve) => { draw(performance.now()); canvas.toBlob((b) => resolve(b), "image/png"); }),
    show(on) { tour = { on, i: -1, at: performance.now() }; return tour.on; },
  };
  return handle;
}
