import type { GraphData } from "./api";

export type Layout = "rings" | "star";
interface Node { id: number; chatId: number; role: "user" | "assistant"; preview: string; size: number; at: string; x: number; y: number; born: number }
export interface GraphHandle { destroy(): void; update(d: GraphData): void; setLayout(l: Layout): void; select(chatId: number | null): void }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Карта беседы: в центре Yaeori, вокруг — кольца (каждый чат — кольцо) или лучи (каждый чат — луч) из сообщений. */
export function mountGraph(canvas: HTMLCanvasElement, tip: HTMLElement, opts: { onPick: (chatId: number) => void }): GraphHandle {
  const ctx = canvas.getContext("2d")!;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let data: GraphData = { chats: [], messages: [] };
  let layout: Layout = "rings", selected: number | null = null;
  let w = 0, h = 0, dpr = 1, raf = 0, t0 = performance.now(), hover: Node | null = null, mouse: { x: number; y: number } | null = null;
  let nodes: Node[] = [], seen = new Set<number>();
  let colors = { brand: "#d9a441", fg: "#ececf1", muted: "#b4b4bd", line: "rgba(255,255,255,.1)", violet: "#a78bfa" }, colorsAt = 0;

  const resize = () => {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  function place(time: number) {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 28;
    const chats = data.chats; nodes = [];
    const byChat = new Map<number, GraphData["messages"]>();
    for (const m of data.messages) { const a = byChat.get(m.chatId) ?? []; a.push(m); byChat.set(m.chatId, a); }
    chats.forEach((c, ci) => {
      const msgs = byChat.get(c.id) ?? [];
      const spin = still ? 0 : time * 0.00006 * (ci % 2 ? -1 : 1) / (1 + ci * 0.25);
      msgs.forEach((m, mi) => {
        let x: number, y: number;
        if (layout === "rings") {
          const r = 54 + ((ci + 1) / Math.max(chats.length, 1)) * (R - 54);
          const a = (mi / Math.max(msgs.length, 1)) * Math.PI * 2 + ci * 0.7 + spin;
          x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r;
        } else {
          const a = (ci / Math.max(chats.length, 1)) * Math.PI * 2 - Math.PI / 2 + (still ? 0 : Math.sin(time * 0.0003 + ci) * 0.03);
          const r = 48 + ((mi + 1) / (msgs.length + 1)) * (R - 48);
          x = cx + Math.cos(a) * r + Math.cos(a + Math.PI / 2) * (mi % 2 ? 7 : -7); y = cy + Math.sin(a) * r + Math.sin(a + Math.PI / 2) * (mi % 2 ? 7 : -7);
        }
        nodes.push({ ...m, x, y, born: bornAt.get(m.id) ?? 0 });
      });
    });
  }
  const bornAt = new Map<number, number>();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (now - colorsAt > 1000) {
      colors = { brand: css("--brand") || colors.brand, fg: css("--fg") || colors.fg, muted: css("--muted") || colors.muted, line: css("--line") || colors.line, violet: css("--violet") || "#a78bfa" };
      colorsAt = now;
    }
    const time = now - t0; place(time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 28, n = data.chats.length;
    ctx.lineWidth = 1; ctx.strokeStyle = colors.line;
    if (layout === "rings") {
      data.chats.forEach((c, ci) => {
        const r = 54 + ((ci + 1) / Math.max(n, 1)) * (R - 54);
        ctx.globalAlpha = c.id === selected ? 1 : 0.55; ctx.strokeStyle = c.id === selected ? colors.brand : colors.line;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      });
    } else {
      data.chats.forEach((c, ci) => {
        const a = (ci / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
        ctx.globalAlpha = c.id === selected ? 1 : 0.55; ctx.strokeStyle = c.id === selected ? colors.brand : colors.line;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
    // связи между соседними сообщениями одного чата
    const last = new Map<number, Node>();
    ctx.lineWidth = 1;
    for (const nd of nodes) {
      const p = last.get(nd.chatId);
      if (p && layout === "star") { ctx.strokeStyle = nd.chatId === selected ? colors.brand : colors.line; ctx.globalAlpha = nd.chatId === selected ? 0.7 : 0.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nd.x, nd.y); ctx.stroke(); }
      last.set(nd.chatId, nd);
    }
    if (layout === "rings" && selected !== null) {
      ctx.strokeStyle = colors.brand; ctx.globalAlpha = 0.35;
      for (const nd of nodes) if (nd.chatId === selected) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nd.x, nd.y); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // центр
    const pulse = still ? 0 : Math.sin(time * 0.002) * 2;
    ctx.fillStyle = colors.brand; ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.arc(cx, cy, 34 + pulse, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.brand; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = colors.fg; ctx.font = "600 12px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Yaeori", cx, cy);
    // узлы
    hover = null;
    if (mouse) { let best = 12; for (const nd of nodes) { const d = Math.hypot(nd.x - mouse.x, nd.y - mouse.y); if (d < best) { best = d; hover = nd; } } }
    for (const nd of nodes) {
      const age = nd.born ? (now - nd.born) / 900 : 1;
      const base = 3 + Math.min(Math.log10(nd.size + 1), 3) * 1.1;
      const r = nd === hover ? base + 2.5 : base;
      if (age < 1) { ctx.globalAlpha = 1 - age; ctx.strokeStyle = colors.brand; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(nd.x, nd.y, r + age * 22, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = selected === null || nd.chatId === selected ? 1 : 0.45;
      ctx.fillStyle = nd.role === "user" ? colors.brand : colors.violet;
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // подписи чатов (в раскладке «Кольца» у начала кольца, в «Звезде» на конце луча)
    ctx.font = "11px system-ui,sans-serif"; ctx.fillStyle = colors.muted; ctx.textBaseline = "middle";
    data.chats.forEach((c, ci) => {
      const label = c.title.length > 22 ? c.title.slice(0, 21) + "…" : c.title;
      if (layout === "rings") { const r = 54 + ((ci + 1) / Math.max(n, 1)) * (R - 54); ctx.textAlign = "left"; ctx.fillText(label, cx + 6, cy - r - 8); }
      else { const a = (ci / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2; const x = cx + Math.cos(a) * (R + 6), y = cy + Math.sin(a) * (R + 6); ctx.textAlign = Math.cos(a) > 0.2 ? "left" : Math.cos(a) < -0.2 ? "right" : "center"; ctx.fillText(label, x, y + (Math.sin(a) > 0.5 ? 8 : Math.sin(a) < -0.5 ? -8 : 0)); }
    });
    if (hover) {
      tip.hidden = false;
      tip.innerHTML = `<strong>${hover.role === "user" ? "Вы" : "Yaeori"}</strong> <small>${new Date(hover.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</small><span></span>`;
      tip.querySelector("span")!.textContent = hover.preview;
      tip.style.left = Math.min(Math.max(8, hover.x + 12), w - 230) + "px"; tip.style.top = Math.min(hover.y + 12, h - 80) + "px";
      canvas.style.cursor = "pointer";
    } else { tip.hidden = true; canvas.style.cursor = "default"; }
  }
  raf = requestAnimationFrame(frame);

  const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointermove", (e) => { mouse = pos(e); });
  canvas.addEventListener("pointerleave", () => { mouse = null; });
  canvas.addEventListener("click", (e) => { mouse = pos(e); if (hover) opts.onPick(hover.chatId); });

  return {
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
    update(d) {
      const first = seen.size === 0;
      for (const m of d.messages) { if (!seen.has(m.id)) { seen.add(m.id); if (!first && !still) bornAt.set(m.id, performance.now()); } }
      data = d;
    },
    setLayout(l) { layout = l; },
    select(id) { selected = id; },
  };
}
