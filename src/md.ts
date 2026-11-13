/** Лёгкая разметка для чата: блоки кода, заголовки, списки, `код`, **жирный**, *курсив*, ссылки http(s).
 *  Всё экранируется. `repair` чинит незавершённую разметку, пока ответ ещё пишется (как remend в Streamdown). */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Закрывает висящие `, **, * и обрезает недописанную ссылку в одном текстовом фрагменте (без блоков кода). */
export function repairInline(t: string): string {
  t = t.replace(/\[([^\]\n]*)\]\([^)\n]*$/, "$1").replace(/\[[^\]\n]*$/, (m) => m.slice(1));
  if (count(t, /`/g) % 2) t += "`";
  else {
    const noCode = t.replace(/`[^`\n]*`/g, "");
    if (count(noCode, /\*\*/g) % 2) t += "**";
    else if (count(noCode.replace(/\*\*/g, ""), /(?<![\w*])\*(?=[^\s*])/g) > count(noCode.replace(/\*\*/g, ""), /(?<=[^\s*])\*(?![\w*])/g)) t += "*";
  }
  return t;
}

/** Отрезает недописанное начало блока кода («`», «``») в самом конце потока. */
export function repair(src: string): string {
  return src.replace(/(^|\n)`{1,2}$/, "$1");
}

function inline(raw: string): string {
  let s = esc(raw);
  const codes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w*])\*([^\s*][^*\n]*?)\*(?![\w*])/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

function block(text: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null, para: string[] = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.join("<br>")}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,4})\s+(.+)/))) { flushP(); flushL(); const n = m[1].length + 2; out.push(`<h${n}>${inline(m[2])}</h${n}>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.+)/))) { flushP(); if (list !== "ul") { flushL(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.+)/))) { flushP(); if (list !== "ol") { flushL(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(inline(line)); }
  }
  flushP(); flushL();
  return out.join("");
}

export function renderText(src: string, streaming = false): string {
  if (streaming) src = repair(src);
  const parts = src.split(/```/);
  return parts.map((p, i) => {
    if (i % 2) { const nl = p.indexOf("\n"); return `<pre><code>${esc(nl >= 0 && /^[\w+-]*$/.test(p.slice(0, nl).trim()) ? p.slice(nl + 1) : p)}</code></pre>`; }
    return block(streaming && i === parts.length - 1 ? repairInline(p) : p);
  }).join("");
}
