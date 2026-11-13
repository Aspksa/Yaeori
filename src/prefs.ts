import { ACCENTS, DEFAULT_CUSTOM_ACCENT, applyAccent, applyTheme, isHexColor, type AccentId, type Theme } from "./accents";

export type TextSize = "small" | "normal" | "large";
export type Density = "comfortable" | "compact";
export type Radius = "sharp" | "normal" | "round";
export interface Prefs { theme: Theme; accent: AccentId; custom: string; textSize: TextSize; density: Density; radius: Radius; collapsed: string[] }

export const KEY = "yaeori:prefs:v1";
export const DEFAULT_PREFS: Prefs = { theme: "auto", accent: "gold", custom: DEFAULT_CUSTOM_ACCENT, textSize: "normal", density: "comfortable", radius: "normal", collapsed: [] };
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

/** Любое сохранённое значение превращается в корректные настройки. */
export function clean(raw: unknown): Prefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    theme: pick(o.theme, ["auto", "light", "dark"], "auto"),
    accent: pick(o.accent, [...ACCENTS.map((a) => a.id), "custom"] as AccentId[], "gold"),
    custom: isHexColor(o.custom) ? o.custom : DEFAULT_CUSTOM_ACCENT,
    textSize: pick(o.textSize, ["small", "normal", "large"], "normal"),
    density: pick(o.density, ["comfortable", "compact"], "comfortable"),
    radius: pick(o.radius, ["sharp", "normal", "round"], "normal"),
    collapsed: Array.isArray(o.collapsed) ? o.collapsed.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
  };
}
export function load(): Prefs {
  try { return clean(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return { ...DEFAULT_PREFS }; }
}
export function save(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* хранилище недоступно */ } }

/** Применяет всё, что влияет на вид: тему, акцент, размер текста, плотность и скругления. */
export function paint(p: Prefs) {
  applyTheme(p.theme);
  applyAccent(p.accent, p.custom);
  const d = document.documentElement.dataset;
  d.textSize = p.textSize; d.density = p.density; d.radius = p.radius;
}
