import { contrast } from "./contrast";

export type AccentId = "gold" | "sakura" | "jade" | "violet" | "custom";
export interface Accent { id: AccentId; label: string; light: { brand: string; fg: string }; dark: { brand: string; fg: string } }

/** `brand` — акцент (кнопки, кольца, маркеры); `fg` — цвет текста НА поверхности цвета brand. */
export const ACCENTS: Accent[] = [
  { id: "gold", label: "Золото", light: { brand: "#ad7a12", fg: "#1a1306" }, dark: { brand: "#d9a441", fg: "#1a1306" } },
  { id: "sakura", label: "Сакура", light: { brand: "#c2457a", fg: "#ffffff" }, dark: { brand: "#f08cb0", fg: "#2a0614" } },
  { id: "jade", label: "Нефрит", light: { brand: "#0b7a5d", fg: "#ffffff" }, dark: { brand: "#4cc9a4", fg: "#04281e" } },
  { id: "violet", label: "Фиалка", light: { brand: "#5b4bdb", fg: "#ffffff" }, dark: { brand: "#a79bff", fg: "#14103a" } },
];
export const DEFAULT_CUSTOM_ACCENT = "#e0662f";
export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export const fgFor = (brand: string) => (contrast(brand, "#ffffff") >= contrast(brand, "#111111") ? "#ffffff" : "#111111");

export type Theme = "auto" | "light" | "dark";
export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
};

export function applyTheme(theme: Theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Ставит --brand и --brand-fg на <html>. Золото — значение по умолчанию в стилях, поэтому просто снимает переопределения. */
export function applyAccent(id: AccentId, custom = DEFAULT_CUSTOM_ACCENT) {
  const root = document.documentElement.style;
  if (id === "custom") {
    const brand = isHexColor(custom) ? custom : DEFAULT_CUSTOM_ACCENT;
    root.setProperty("--brand", brand); root.setProperty("--brand-fg", fgFor(brand));
    return;
  }
  const a = ACCENTS.find((x) => x.id === id);
  if (!a || id === "gold") { root.removeProperty("--brand"); root.removeProperty("--brand-fg"); return; }
  const v = isDark() ? a.dark : a.light;
  root.setProperty("--brand", v.brand); root.setProperty("--brand-fg", v.fg);
}
export const swatchColor = (a: Accent) => (isDark() ? a.dark.brand : a.light.brand);
