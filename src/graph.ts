import type { GraphData } from "./api";

export type Layout = "rings" | "circle" | "hex" | "force";
export type MapTheme = "accent" | "ocean" | "neon" | "bordo" | "paper";
export type Grouping = "chat" | "day";
export interface MapOptions { layout: Layout; theme: MapTheme; group: Grouping; rotation: number; force: number; size: number; labels: boolean; links: boolean; collapsed: string[] }
export const DEFAULT_MAP: MapOptions = { layout: "rings", theme: "accent", group: "chat", rotation: 0.25, force: 0.5, size: 1, labels: false, links: true, collapsed: [] };
export const MAP_THEMES: { id: MapTheme; label: string; swatch: string[] }[] = [
  { id: "accent", label: "По акценту", swatch: ["#d9a441", "#a78bfa", "#6fcf97", "#f0a030"] },
  { id: "ocean", label: "Океан", swatch: ["#4cc9a4", "#4aa8e8", "#7c9cff", "#e6c35c"] },
  { id: "neon", label: "Неон", swatch: ["#d6ff3d", "#ff3dac", "#3dffe0", "#ffb13d"] },
  { id: "bordo", label: "Бордо", swatch: ["#f0a35c", "#e05a6b", "#d9c27a", "#c97bb0"] },
  { id: "paper", label: "Бумага", swatch: ["#8a5a1c", "#2f6f8f", "#6b3fa0", "#2f7f4f"] },
];
export interface SysItem { id: string; label: string; detail: string; ok: boolean; icon: "key" | "spark" | "db" | "chat" | "palette" }

interface Pal { bg: string; hubs: string[]; user: string; bot: string; line: string; text: string; muted: string; warn: string }
const FIXED: Record<Exclude<MapTheme, "accent">, Pal> = {
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
interface N { key: string; kind: Kind; id: number; chatId: number; grp: string; role?: "user" | "assistant"; text: string; size: number; at: string; x: number; y: number; tx: number; ty: number; vx: number; vy: number; born: number; hue: number; visible: boolean; key2?: boolean; sys?: SysItem }
export interface GraphHandle {
  destroy(): void; update(d: GraphData): void; select(chatId: number | null): void;
  setOptions(p: Partial<MapOptions>): void; options(): MapOptions; setSystem(items: SysItem[]): void;
  expandAll(): void; collapseAll(): void; recenter(): void; search(q: string): void; png(): Promise<Blob | null>; show(on: boolean): boolean;
}
interface Callbacks { onPick: (chatId: number) => void; onCollapse?: (keys: string[]) => void; onSystem?: (id: string) => void; onShowEnd?: () => void }

const R = 300, MONO = "ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace", TAU = Math.PI * 2;
const hexCell = (i: number): [number, number] => {
  const r1: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  if (i === 0) return [0, 0];
  if (i <= 6) return r1[i - 1]!;
  const j = i - 7, side = Math.floor(j / 2), c = r1[side % 6]!, nx = r1[(side + 1) % 6]!;
  return j % 2 === 0 ? [c[0] * 2, c[1] * 2] : [c[0] + nx[0], c[1] + nx[1]];
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

  const fitK = () => Math.min(w, h) / (R * 2.5);
  const fit = () => { cam = { x: 0, y: 0, k: fitK() }; };
  const resize = () => {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
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
      for (const m of data.messages) { const k = "d" + dayKey(m.at), g = byDay.get(k) ?? { key: k, label: dayLabel(k.slice(1)), count: 0, chatId: m.chatId }; g.count++; g.chatId = m.chatId; byDay.set(k, g); }
      groups.push(...[...byDay.values()].slice(-12));
    }
    const gKey = (m: GraphData["messages"][number]) => (o.group === "chat" ? "c" + m.chatId : "d" + dayKey(m.at));
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
      Object.assign(n, { chatId: m.chatId, grp, role: m.role, text: m.preview, size: m.size, at: m.at, hue: hub.hue, key2: (m.role === "assistant" && m.size > 350) || lastOf.get(grp) === m.id });
    }
    sysItems.forEach((s, i) => { const key = "s" + s.id; keep.add(key); let n = nodes.get(key); if (!n) { n = mk(key, "sys", { x: 0, y: 0 }); nodes.set(key, n); } Object.assign(n, { sys: s, text: s.label, hue: i }); });
    for (const k of [...nodes.keys()]) if (!keep.has(k)) nodes.delete(k);
    order = [...nodes.values()];
  }

  const msgsOf = (grp: string) => order.filter((n) => n.kind === "msg" && n.grp === grp);
  const radius = (n: N) => n.kind === "core" ? 26 : n.kind === "sys" ? 14 : n.kind === "hub" ? (8 + Math.sqrt(n.size) * 0.9) * o.size : (n.key2 ? 4.6 : 2.7 + Math.min(Math.log10(n.size + 1), 3) * 0.5) * o.size;

  function targets() {
    const hubs = order.filter((n) => n.kind === "hub"), nh = hubs.length, collapsed = new Set(o.collapsed);
    for (const n of order) n.visible = n.kind !== "msg" || !collapsed.has("h" + n.grp);
    const sys = order.filter((n) => n.kind === "sys");
    sys.forEach((sn, i) => { const a = (i / Math.max(sys.length, 1)) * TAU - 1.5708 - rot * 0.6, rr = R * 1.08; sn.tx = Math.cos(a) * rr; sn.ty = Math.sin(a) * rr; if (o.layout === "force") { sn.x = sn.tx; sn.y = sn.ty; } });
    if (o.layout === "force") return;
    const core = nodes.get("core")!;
    if (o.layout === "rings") {
      hubs.forEach((hb, i) => {
        const a = (i / nh) * TAU - 1.5708 + rot, hr = nh === 1 ? R * 0.45 : R * 0.58; hb.tx = Math.cos(a) * hr; hb.ty = Math.sin(a) * hr;
        const ms = collapsed.has(hb.key) ? [] : msgsOf(hb.grp), per = 9, span = Math.min(TAU / Math.max(nh, 1) * 0.78, 1.25);
        ms.forEach((m, j) => { const row = Math.floor(j / per), col = j % per, cols = Math.min(per, ms.length - row * per);
          const aa = a + (cols > 1 ? (col / (cols - 1) - 0.5) * span : 0), rr = hr + 26 + row * 15; m.tx = Math.cos(aa) * rr; m.ty = Math.sin(aa) * rr; });
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
    if (hs > 12) {
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
    for (const rr of [R * 0.28, R * 0.58, R * 0.85, R * 1.08]) { ctx.globalAlpha = rr === R * 1.08 ? 0.9 : 0.55; ctx.beginPath(); ctx.arc(c0.x, c0.y, rr * cam.k, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
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
    // наведение: что подсвечивать
    hover = null;
    if (mouse && !drag?.moved) { const wp = toWorld(mouse.x, mouse.y); let best = 1e9; for (const n of order) { if (!n.visible || n.kind === "core") continue; const d = Math.hypot(n.x - wp.x, n.y - wp.y), lim = (radius(n) + 5) / Math.max(cam.k, 0.6); if (d < lim && d < best) { best = d; hover = n; } } }
    const hl = hover?.kind === "hub" ? hover.grp : hover?.kind === "msg" ? hover.grp : null;
    const dimOf = (n: N) => (query && !matches(n) ? 0.15 : selected !== null && n.chatId !== selected && o.layout !== "force" ? 0.4 : 1);
    // связи: центр → отделы
    for (const hb of hubs) {
      const p = toScreen(hb.x, hb.y), on = hb.chatId === selected || hl === hb.grp;
      const g = ctx.createLinearGradient(c0.x, c0.y, p.x, p.y); g.addColorStop(0, pal.line); g.addColorStop(1, on ? hue(hb) : pal.line);
      ctx.strokeStyle = g; ctx.globalAlpha = on ? 0.95 : 0.8; ctx.lineWidth = on ? 1.6 : 1; ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    // лучи: отдел → сообщения (затухают с расстоянием)
    for (const m of order) {
      if (m.kind !== "msg" || !m.visible) continue;
      const hb = byKey.get("h" + m.grp); if (!hb) continue;
      const a = toScreen(hb.x, hb.y), b = toScreen(m.x, m.y), on = hb.chatId === selected || hl === m.grp;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, on ? hue(hb) : pal.line); g.addColorStop(1, "transparent");
      ctx.strokeStyle = g; ctx.globalAlpha = (on ? 0.8 : 0.5) * dimOf(m); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // связи между чатами: общие слова
    if (o.links) for (const l of data.links) {
      const a = byKey.get("m" + l.a), b = byKey.get("m" + l.b); if (!a || !b || !a.visible || !b.visible) continue;
      const on = hover && (hover.key === a.key || hover.key === b.key);
      if (hover && !on && hover.kind === "msg") continue;
      const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y), mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      ctx.strokeStyle = on ? pal.text : pal.muted; ctx.globalAlpha = (on ? 0.85 : 0.16) * Math.min(1, 0.5 + l.w * 0.25); ctx.lineWidth = on ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mx + (c0.x - mx) * 0.35, my + (c0.y - my) * 0.35, pb.x, pb.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // центр: двойное кольцо и знак
    const cr = 26 * cam.k, pulse = still ? 0 : Math.sin(now * 0.002) * 2 * cam.k;
    ctx.fillStyle = pal.hubs[0]!; ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr * 1.7 + pulse, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.5;
    ctx.strokeStyle = pal.hubs[0]!; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr * 1.35, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 2;
    ctx.fillStyle = pal.bg; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = pal.text; ctx.lineWidth = Math.max(1.2, 1.6 * cam.k); ctx.beginPath(); ctx.arc(c0.x - cr * 0.16, c0.y + cr * 0.06, cr * 0.42, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(c0.x + cr * 0.16, c0.y - cr * 0.06, cr * 0.42, 0, TAU); ctx.stroke();
    ctx.fillStyle = pal.text; ctx.font = `600 ${Math.max(9, Math.min(13, 11 * cam.k))}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("YAEORI", c0.x, c0.y + cr * 1.5 + 6);
    // узлы
    for (const n of order) {
      if (n.kind === "core" || !n.visible) continue;
      const p = toScreen(n.x, n.y); if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      const r = Math.max(n.kind === "msg" ? 1.6 : 3, radius(n) * cam.k) + (n === hover ? 2 : 0), hit = !query || matches(n), dim = dimOf(n);
      const age = n.born ? (now - n.born) / 900 : 1;
      if (age < 1) { ctx.globalAlpha = 1 - age; ctx.strokeStyle = pal.user; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + age * 24, 0, TAU); ctx.stroke(); }
      if (n.kind === "sys") {
        const s = n.sys!, col = s.ok ? pal.hubs[0]! : pal.warn;
        ctx.globalAlpha = dim; ctx.fillStyle = pal.bg; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = n === hover ? 2.2 : 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
        ctx.save(); ctx.translate(p.x - r * 0.55, p.y - r * 0.55); ctx.scale((r * 1.1) / 24, (r * 1.1) / 24); ctx.strokeStyle = col; ctx.lineWidth = 2 / ((r * 1.1) / 24) * 0.9; ctx.stroke(PATHS[s.icon]); ctx.restore();
        ctx.globalAlpha = 1; continue;
      }
      ctx.globalAlpha = dim; ctx.fillStyle = n.kind === "hub" ? hue(n) : n.role === "user" ? pal.user : pal.bot;
      if (n.kind === "msg" && !n.key2) { const tw = still ? 1 : 0.88 + Math.sin(now * 0.002 + n.id * 1.7) * 0.12; ctx.globalAlpha = dim * tw; ctx.fillRect(p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); }
      // свечение у ключевых, выбранных, найденных и наведённых
      if (n.kind === "hub" || n === hover || (n.kind === "msg" && n.key2 && n.chatId === selected) || (query && hit)) {
        ctx.globalAlpha = n === hover ? 0.55 : 0.28; ctx.strokeStyle = n.kind === "hub" ? hue(n) : (query && hit) ? pal.text : ctx.fillStyle as string; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 + (still ? 0 : Math.sin(now * 0.003) * 1.2), 0, TAU); ctx.stroke();
        if (n === hover) { ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, 0, TAU); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      if (n.kind === "hub") {
        const t = (n.text.length > 16 ? n.text.slice(0, 15) + "…" : n.text).toUpperCase() + (o.collapsed.includes(n.key) ? `  +${n.size}` : "");
        ctx.font = `600 11px ${MONO}`; ctx.fillStyle = hue(n); ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.globalAlpha = query && !hit ? 0.3 : 1; ctx.fillText(t, p.x, p.y - r - 8); ctx.globalAlpha = 1;
      } else if (n.kind === "msg" && (o.labels || n.key2) && cam.k > 1.3) {
        ctx.font = `10px ${MONO}`; ctx.fillStyle = pal.muted; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.globalAlpha = dim; ctx.fillText((n.text.split(/\s+/)[0] ?? "").slice(0, 14), p.x + r + 4, p.y); ctx.globalAlpha = 1;
      }
    }
    // подпись системного кольца
    if (sysItems.length) { const t = toScreen(0, -R * 1.08 - 26); ctx.font = `600 10px ${MONO}`; ctx.fillStyle = pal.muted; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText("СИСТЕМА", t.x, t.y); }
    // подсказка
    if (hover) {
      const p = toScreen(hover.x, hover.y); tip.hidden = false;
      const links = hover.kind === "msg" ? data.links.filter((l) => l.a === hover!.id || l.b === hover!.id) : [];
      const words = [...new Set(links.flatMap((l) => l.words))].slice(0, 4);
      tip.innerHTML = hover.kind === "hub" ? `<strong></strong><small>${hover.size} сообщ.</small><span>Двойной щелчок — свернуть или развернуть</span>`
        : hover.kind === "sys" ? `<strong></strong><small></small>`
        : `<strong>${hover.role === "user" ? "Вы" : "Yaeori"}</strong><small>${new Date(hover.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</small><span></span>${words.length ? `<em></em>` : ""}`;
      if (hover.kind === "hub") tip.querySelector("strong")!.textContent = hover.text;
      else if (hover.kind === "sys") { tip.querySelector("strong")!.textContent = hover.sys!.label; tip.querySelector("small")!.textContent = hover.sys!.detail; }
      else { tip.querySelector("span")!.textContent = hover.text; if (words.length) tip.querySelector("em")!.textContent = "Связано: " + words.join(", "); }
      tip.style.left = Math.min(Math.max(8, p.x + 12), Math.max(8, w - 232)) + "px"; tip.style.top = Math.min(p.y + 12, Math.max(8, h - 96)) + "px"; canvas.style.cursor = "pointer";
    } else { tip.hidden = true; canvas.style.cursor = drag ? "grabbing" : "grab"; }
  }
  rebuild(); raf = requestAnimationFrame(frame);

  const pos = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const stopTour = () => { if (tour.on) { tour.on = false; cb.onShowEnd?.(); } };
  canvas.addEventListener("pointerdown", (e) => { stopTour(); const p = pos(e); drag = { sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { const p = pos(e); mouse = p; if (drag) { const dx = p.x - drag.sx, dy = p.y - drag.sy; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; } } });
  canvas.addEventListener("pointerup", (e) => {
    const was = drag; drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }
    if (was && !was.moved && hover) { if (hover.kind === "sys") cb.onSystem?.(hover.sys!.id); else cb.onPick(hover.chatId); }
  });
  canvas.addEventListener("pointerleave", () => { mouse = null; });
  canvas.addEventListener("dblclick", () => {
    if (hover?.kind === "hub") { const k = hover.key; o = { ...o, collapsed: o.collapsed.includes(k) ? o.collapsed.filter((x) => x !== k) : [...o.collapsed, k] }; cb.onCollapse?.(o.collapsed); }
    else if (!hover) fit();
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); stopTour(); const p = pos(e), before = toWorld(p.x, p.y);
    cam.k = Math.min(6, Math.max(0.2, cam.k * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(p.x, p.y); cam.x += before.x - after.x; cam.y += before.y - after.y;
  }, { passive: false });

  return {
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
    update(d) {
      const first = seen.size === 0; data = d; rebuild();
      for (const m of d.messages) if (!seen.has(m.id)) { seen.add(m.id); if (!first && !still) { const n = nodes.get("m" + m.id); if (n) n.born = performance.now(); } }
    },
    select(id) { selected = id; },
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
}
