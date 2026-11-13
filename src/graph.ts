import type { GraphData } from "./api";

export type Layout = "rings" | "circle" | "hex" | "force";
export type MapTheme = "accent" | "ocean" | "neon" | "bordo" | "paper";
export interface MapOptions { layout: Layout; theme: MapTheme; rotation: number; force: number; size: number; labels: boolean; collapsed: number[] }
export const DEFAULT_MAP: MapOptions = { layout: "rings", theme: "accent", rotation: 0.25, force: 0.5, size: 1, labels: false, collapsed: [] };
export const MAP_THEMES: { id: MapTheme; label: string; swatch: string[] }[] = [
  { id: "accent", label: "По акценту", swatch: ["#d9a441", "#a78bfa", "#6fcf97", "#f0a030"] },
  { id: "ocean", label: "Океан", swatch: ["#4cc9a4", "#4aa8e8", "#7c9cff", "#e6c35c"] },
  { id: "neon", label: "Неон", swatch: ["#d6ff3d", "#ff3dac", "#3dffe0", "#ffb13d"] },
  { id: "bordo", label: "Бордо", swatch: ["#f0a35c", "#e05a6b", "#d9c27a", "#c97bb0"] },
  { id: "paper", label: "Бумага", swatch: ["#8a5a1c", "#2f6f8f", "#6b3fa0", "#2f7f4f"] },
];

interface Pal { bg: string; hubs: string[]; user: string; bot: string; line: string; text: string; muted: string }
const FIXED: Record<Exclude<MapTheme, "accent">, Pal> = {
  ocean: { bg: "#0d1b26", hubs: ["#4cc9a4", "#4aa8e8", "#7c9cff", "#e6c35c", "#f08c6a", "#b48cf0"], user: "#4cc9a4", bot: "#4aa8e8", line: "rgba(120,200,220,.2)", text: "#d4f1ea", muted: "#7fa9b3" },
  neon: { bg: "#05050a", hubs: ["#d6ff3d", "#ff3dac", "#3dffe0", "#ffb13d", "#a35bff", "#3d8bff"], user: "#d6ff3d", bot: "#ff3dac", line: "rgba(255,255,255,.14)", text: "#f2f2f2", muted: "#9a9aa8" },
  bordo: { bg: "#160a0c", hubs: ["#f0a35c", "#e05a6b", "#d9c27a", "#c97bb0", "#e8855c", "#a8c6a0"], user: "#f0a35c", bot: "#e05a6b", line: "rgba(255,170,150,.16)", text: "#f6e2db", muted: "#b38d86" },
  paper: { bg: "#f6f1e6", hubs: ["#8a5a1c", "#2f6f8f", "#6b3fa0", "#2f7f4f", "#b3402f", "#4a4a8a"], user: "#8a5a1c", bot: "#2f6f8f", line: "rgba(0,0,0,.16)", text: "#2a2418", muted: "#7a705c" },
};
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function palette(t: MapTheme): Pal {
  if (t !== "accent") return FIXED[t];
  const brand = css("--brand") || "#d9a441", violet = css("--violet") || "#a78bfa";
  return { bg: css("--surface") || "#141417", hubs: [brand, violet, css("--ok") || "#6fcf97", css("--warn") || "#f0a030", css("--danger") || "#f87171", css("--muted") || "#b4b4bd"],
    user: brand, bot: violet, line: css("--line") || "rgba(255,255,255,.1)", text: css("--fg") || "#ececf1", muted: css("--muted") || "#b4b4bd" };
}

type Kind = "core" | "hub" | "msg";
interface N { key: string; kind: Kind; id: number; chatId: number; role?: "user" | "assistant"; text: string; size: number; at: string; x: number; y: number; tx: number; ty: number; vx: number; vy: number; born: number; hue: number; visible: boolean }
export interface GraphHandle {
  destroy(): void; update(d: GraphData): void; select(chatId: number | null): void;
  setOptions(p: Partial<MapOptions>): void; options(): MapOptions;
  expandAll(): void; collapseAll(): void; recenter(): void; search(q: string): void; png(): Promise<Blob | null>;
}

const R = 300; // радиус «мира» в условных единицах; масштаб подбирается под размер холста
const hexCell = (i: number): [number, number] => { // i-я ячейка спирали сот: 0 — центр
  const ring1: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  if (i === 0) return [0, 0];
  if (i <= 6) return ring1[i - 1]!;
  const j = i - 7, side = Math.floor(j / 2), k = j % 2; // кольцо 2: углы и середины рёбер
  const c = ring1[side % 6]!, nx = ring1[(side + 1) % 6]!;
  return k === 0 ? [c[0] * 2, c[1] * 2] : [c[0] + nx[0], c[1] + nx[1]];
};

export function mountGraph(canvas: HTMLCanvasElement, tip: HTMLElement, cb: { onPick: (chatId: number) => void; onCollapse?: (ids: number[]) => void }, initial: MapOptions = DEFAULT_MAP): GraphHandle {
  const ctx = canvas.getContext("2d")!;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let o: MapOptions = { ...DEFAULT_MAP, ...initial };
  let data: GraphData = { chats: [], messages: [] };
  const nodes = new Map<string, N>(); let order: N[] = [];
  let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now(), rot = 0, selected: number | null = null, query = "";
  let cam = { x: 0, y: 0, k: 1 }, fitted = false, hover: N | null = null, mouse: { x: number; y: number } | null = null;
  let drag: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null, pal = palette(o.theme), palAt = 0;
  const seen = new Set<number>();

  const fit = () => { cam = { x: 0, y: 0, k: Math.min(w, h) / (R * 2.7) }; };
  const resize = () => {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!fitted && r.width > 10) { fit(); fitted = true; }
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const toWorld = (sx: number, sy: number) => ({ x: (sx - w / 2) / cam.k + cam.x, y: (sy - h / 2) / cam.k + cam.y });
  const toScreen = (x: number, y: number) => ({ x: w / 2 + (x - cam.x) * cam.k, y: h / 2 + (y - cam.y) * cam.k });

  function rebuild() {
    const keep = new Set<string>(["core"]);
    if (!nodes.has("core")) nodes.set("core", { key: "core", kind: "core", id: 0, chatId: 0, text: "Yaeori", size: 0, at: "", x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, born: 0, hue: 0, visible: true });
    data.chats.forEach((c, i) => {
      const key = "c" + c.id; keep.add(key);
      let n = nodes.get(key);
      if (!n) { const a = (i / Math.max(data.chats.length, 1)) * 6.283; n = { key, kind: "hub", id: c.id, chatId: c.id, text: c.title, size: c.count, at: "", x: Math.cos(a) * 40, y: Math.sin(a) * 40, tx: 0, ty: 0, vx: 0, vy: 0, born: 0, hue: i, visible: true }; nodes.set(key, n); }
      n.text = c.title; n.size = c.count; n.hue = i;
    });
    for (const m of data.messages) {
      const key = "m" + m.id; keep.add(key);
      let n = nodes.get(key);
      const hub = nodes.get("c" + m.chatId);
      if (!n) { n = { key, kind: "msg", id: m.id, chatId: m.chatId, role: m.role, text: m.preview, size: m.size, at: m.at, x: (hub?.x ?? 0) + (Math.random() - .5) * 20, y: (hub?.y ?? 0) + (Math.random() - .5) * 20, tx: 0, ty: 0, vx: 0, vy: 0, born: 0, hue: hub?.hue ?? 0, visible: true }; nodes.set(key, n); }
      n.hue = hub?.hue ?? 0;
    }
    for (const k of [...nodes.keys()]) if (!keep.has(k)) nodes.delete(k);
    order = [...nodes.values()];
  }

  const msgsOf = (chatId: number) => order.filter((n) => n.kind === "msg" && n.chatId === chatId);
  const radius = (n: N) => n.kind === "core" ? 22 : n.kind === "hub" ? (8 + Math.sqrt(n.size) * 0.9) * o.size : (3 + Math.min(Math.log10(n.size + 1), 3) * 1.1) * o.size;

  function targets() {
    const hubs = order.filter((n) => n.kind === "hub"), nh = hubs.length, collapsed = new Set(o.collapsed);
    for (const n of order) n.visible = n.kind !== "msg" || !collapsed.has(n.chatId);
    if (o.layout === "force") return;
    if (o.layout === "rings") {
      hubs.forEach((hb, i) => {
        const a = (i / nh) * 6.283 - 1.5708 + rot, hr = nh === 1 ? R * 0.45 : R * 0.55;
        hb.tx = Math.cos(a) * hr; hb.ty = Math.sin(a) * hr;
        const ms = collapsed.has(hb.chatId) ? [] : msgsOf(hb.chatId), per = 7, span = Math.min(6.283 / Math.max(nh, 1) * 0.8, 1.3);
        ms.forEach((m, j) => { const row = Math.floor(j / per), col = j % per, cols = Math.min(per, ms.length - row * per);
          const aa = a + (cols > 1 ? (col / (cols - 1) - 0.5) * span : 0), rr = hr + 30 + row * 24; m.tx = Math.cos(aa) * rr; m.ty = Math.sin(aa) * rr; });
      });
    } else if (o.layout === "circle") {
      const vis = hubs.map((hb) => (collapsed.has(hb.chatId) ? [] : msgsOf(hb.chatId))), total = vis.reduce((s, v) => s + Math.max(v.length, 1), 0) || 1;
      let at = 0;
      hubs.forEach((hb, i) => {
        const cnt = Math.max(vis[i]!.length, 1), arc = (cnt / total) * 6.283, a0 = at - 1.5708 + rot; at += arc;
        const mid = a0 + arc / 2; hb.tx = Math.cos(mid) * R * 0.62; hb.ty = Math.sin(mid) * R * 0.62;
        vis[i]!.forEach((m, j) => { const aa = a0 + ((j + 0.5) / cnt) * arc; m.tx = Math.cos(aa) * R; m.ty = Math.sin(aa) * R; });
      });
    } else { // hex
      const s = 105, c = nodes.get("core")!;
      const pos = (i: number) => { const [q, r] = hexCell(i); return { x: s * Math.sqrt(3) * (q + r / 2), y: s * 1.5 * r }; };
      c.tx = pos(0).x; c.ty = pos(0).y;
      hubs.forEach((hb, i) => {
        const p = pos(i + 1); hb.tx = p.x; hb.ty = p.y;
        const ms = collapsed.has(hb.chatId) ? [] : msgsOf(hb.chatId);
        ms.forEach((m, j) => { const rr = Math.min(s * 0.82, 20 + Math.sqrt(j + 1) * 13), aa = j * 2.4 + rot; m.tx = p.x + Math.cos(aa) * rr; m.ty = p.y + Math.sin(aa) * rr; });
      });
    }
    const core = nodes.get("core")!; if (o.layout !== "hex") { core.tx = 0; core.ty = 0; }
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
      const hb = nodes.get("c" + m.chatId); if (!hb) continue;
      const dx = m.x - hb.x, dy = m.y - hb.y, d = Math.hypot(dx, dy) || 1, f = (d - 38) * k; m.vx -= (dx / d) * f; m.vy -= (dy / d) * f; hb.vx += (dx / d) * f * 0.1; hb.vy += (dy / d) * f * 0.1;
    }
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i]!, b = vis[j]!, dx = a.x - b.x, dy = a.y - b.y;
      if (Math.abs(dx) > 26 || Math.abs(dy) > 26) continue;
      const d = Math.hypot(dx, dy) || 1; if (d >= 26) continue; const f = (26 - d) * 0.05; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of order) { if (n.kind === "core") { n.x = 0; n.y = 0; continue; } n.vx *= 0.82; n.vy *= 0.82; n.x += Math.max(-12, Math.min(12, n.vx)); n.y += Math.max(-12, Math.min(12, n.vy)); }
  }

  const matches = (n: N) => !query || n.text.toLowerCase().includes(query);
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - last, 50); last = now;
    if (!still) rot += dt * o.rotation * 0.0002;
    if (now - palAt > 1000) { pal = palette(o.theme); palAt = now; }
    targets();
    if (o.layout === "force") physics();
    else for (const n of order) { n.x += (n.tx - n.x) * 0.14; n.y += (n.ty - n.y) * 0.14; }
    draw(now);
  }

  function draw(now: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, h);
    const hubs = order.filter((n) => n.kind === "hub"), core = nodes.get("core")!, hue = (n: N) => pal.hubs[n.hue % pal.hubs.length]!;
    // соты
    if (o.layout === "hex") {
      const s = 105;
      const cells = [core, ...hubs];
      cells.forEach((cn, i) => {
        const [cx, cy] = [cn.x, cn.y]; ctx.beginPath();
        for (let v = 0; v < 6; v++) { const a = Math.PI / 6 + v * Math.PI / 3, p = toScreen(cx + Math.cos(a) * s * 0.98, cy + Math.sin(a) * s * 0.98); v ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.closePath(); const col = i === 0 ? pal.muted : hue(cn);
        ctx.globalAlpha = 0.06; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = cn.chatId === selected && i ? 0.9 : 0.35; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    // связи
    ctx.lineWidth = 1;
    const c0 = toScreen(core.x, core.y);
    for (const hb of hubs) {
      const p = toScreen(hb.x, hb.y), on = hb.chatId === selected || hover?.chatId === hb.chatId;
      ctx.strokeStyle = on ? hue(hb) : pal.line; ctx.globalAlpha = on ? 0.9 : 0.8; ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    for (const m of order) {
      if (m.kind !== "msg" || !m.visible) continue;
      const hb = nodes.get("c" + m.chatId); if (!hb) continue; const a = toScreen(hb.x, hb.y), b = toScreen(m.x, m.y), on = m.chatId === selected || hover?.chatId === m.chatId;
      ctx.strokeStyle = on ? hue(hb) : pal.line; ctx.globalAlpha = (on ? 0.55 : 0.4) * (query && !matches(m) ? 0.3 : 1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // центр
    const cr = 22 * cam.k, pulse = still ? 0 : Math.sin(now * 0.002) * 2 * cam.k;
    ctx.fillStyle = pal.hubs[0]!; ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr * 1.5 + pulse, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.hubs[0]!; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr, 0, 6.283); ctx.stroke();
    ctx.fillStyle = pal.text; ctx.font = `600 ${Math.max(9, Math.min(13, 12 * cam.k))}px ui-monospace,Consolas,monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("YAEORI", c0.x, c0.y);
    // наведение
    hover = null;
    if (mouse && !drag?.moved) { const wp = toWorld(mouse.x, mouse.y); let best = 1e9; for (const n of order) { if (!n.visible || n.kind === "core") continue; const d = Math.hypot(n.x - wp.x, n.y - wp.y), lim = (radius(n) + 5) / cam.k * Math.max(cam.k, 0.6); if (d < lim && d < best) { best = d; hover = n; } } }
    // узлы
    for (const n of order) {
      if (n.kind === "core" || !n.visible) continue;
      const p = toScreen(n.x, n.y); if (p.x < -30 || p.y < -30 || p.x > w + 30 || p.y > h + 30) continue;
      const r = Math.max(2, radius(n) * cam.k) + (n === hover ? 2 : 0), hit = !query || matches(n), dim = (query && !hit) || (selected !== null && n.chatId !== selected && o.layout !== "force") ? 0.35 : 1;
      const age = n.born ? (now - n.born) / 900 : 1;
      if (age < 1) { ctx.globalAlpha = 1 - age; ctx.strokeStyle = pal.user; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + age * 22, 0, 6.283); ctx.stroke(); }
      ctx.globalAlpha = query && !hit ? 0.15 : dim;
      ctx.fillStyle = n.kind === "hub" ? hue(n) : n.role === "user" ? pal.user : pal.bot;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill();
      if (n.kind === "hub") { ctx.globalAlpha = 0.25; ctx.strokeStyle = hue(n); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 6.283); ctx.stroke(); }
      if (query && hit) { ctx.globalAlpha = 1; ctx.strokeStyle = pal.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 6.283); ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (n.kind === "hub") {
        const t = (n.text.length > 16 ? n.text.slice(0, 15) + "…" : n.text).toUpperCase() + (o.collapsed.includes(n.chatId) ? `  +${n.size}` : "");
        ctx.font = "600 11px ui-monospace,Consolas,monospace"; ctx.fillStyle = hue(n); ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.globalAlpha = query && !hit ? 0.3 : 1; ctx.fillText(t, p.x, p.y - r - 7); ctx.globalAlpha = 1;
      } else if (o.labels && cam.k > 1.3) {
        ctx.font = "10px ui-monospace,Consolas,monospace"; ctx.fillStyle = pal.muted; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(n.text.slice(0, 18), p.x + r + 4, p.y);
      }
    }
    if (hover) {
      const p = toScreen(hover.x, hover.y); tip.hidden = false;
      tip.innerHTML = hover.kind === "hub" ? `<strong></strong><small>${hover.size} сообщ.</small><span>Двойной щелчок — свернуть или развернуть</span>`
        : `<strong>${hover.role === "user" ? "Вы" : "Yaeori"}</strong><small>${new Date(hover.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</small><span></span>`;
      if (hover.kind === "hub") tip.querySelector("strong")!.textContent = hover.text; else tip.querySelector("span")!.textContent = hover.text;
      tip.style.left = Math.min(Math.max(8, p.x + 12), Math.max(8, w - 232)) + "px"; tip.style.top = Math.min(p.y + 12, Math.max(8, h - 84)) + "px"; canvas.style.cursor = "pointer";
    } else { tip.hidden = true; canvas.style.cursor = drag ? "grabbing" : "grab"; }
  }
  rebuild(); raf = requestAnimationFrame(frame);

  const pos = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointerdown", (e) => { const p = pos(e); drag = { sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { const p = pos(e); mouse = p; if (drag) { const dx = p.x - drag.sx, dy = p.y - drag.sy; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { cam.x = drag.cx - dx / cam.k; cam.y = drag.cy - dy / cam.k; } } });
  canvas.addEventListener("pointerup", (e) => { const was = drag; drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ } if (was && !was.moved && hover) cb.onPick(hover.chatId); });
  canvas.addEventListener("pointerleave", () => { mouse = null; });
  canvas.addEventListener("dblclick", () => {
    if (hover?.kind === "hub") { const id = hover.chatId; o = { ...o, collapsed: o.collapsed.includes(id) ? o.collapsed.filter((x) => x !== id) : [...o.collapsed, id] }; cb.onCollapse?.(o.collapsed); }
    else if (!hover) fit();
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); const p = pos(e), before = toWorld(p.x, p.y);
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
    setOptions(p) { const prev = o.layout; o = { ...o, ...p }; if (p.theme) palAt = 0; if (p.layout && p.layout !== prev && p.layout === "force") for (const n of order) { n.vx = 0; n.vy = 0; } },
    options: () => o,
    expandAll() { o = { ...o, collapsed: [] }; cb.onCollapse?.(o.collapsed); },
    collapseAll() { o = { ...o, collapsed: data.chats.map((c) => c.id) }; cb.onCollapse?.(o.collapsed); },
    recenter() { fit(); },
    search(q) { query = q.trim().toLowerCase(); },
    png: () => new Promise((resolve) => { draw(performance.now()); canvas.toBlob((b) => resolve(b), "image/png"); }),
  };
}
