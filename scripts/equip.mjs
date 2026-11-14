import * as contracts from "./contracts.mjs";
// Техника: марки, модели, госномера, VIN, инвентарные номера, узлы. Чистые функции без базы.
const CYR = "АВЕКМНОРСТУХ", LAT = "ABEKMHOPCTYX";
const lat2cyr = (c) => { const i = LAT.indexOf(c.toUpperCase()); return i >= 0 ? CYR[i] : c.toUpperCase(); };

/** Марки: каноническое имя → написания. strict: слово обычное («газ», «урал»), берём только с моделью или в верхнем регистре. */
const BRANDS = [
  ["КамАЗ", ["камаз", "kamaz"]], ["МАЗ", ["маз", "maz"], true], ["ЗИЛ", ["зил", "zil"], true], ["УАЗ", ["уаз", "uaz"]], ["ГАЗ", ["газ", "gaz"], true], ["Урал", ["урал", "ural"], true],
  ["Volvo", ["volvo", "вольво"]], ["Scania", ["scania", "скания"]], ["MAN", ["man", "ман"], true], ["Mercedes", ["mercedes", "мерседес"]], ["Hitachi", ["hitachi", "хитачи"]], ["Komatsu", ["komatsu", "коматсу"]],
  ["Caterpillar", ["caterpillar", "cat", "катерпиллар"], true], ["JCB", ["jcb", "джисиби"]], ["Hyundai", ["hyundai", "хендай", "хёндэ"]], ["Shacman", ["shacman", "шакман"]], ["Howo", ["howo", "хово"]], ["Sitrak", ["sitrak", "ситрак"]],
  ["FAW", ["faw", "фав"]], ["Foton", ["foton", "фотон"]], ["Liebherr", ["liebherr", "либхер"]], ["Doosan", ["doosan", "досан"]], ["МТЗ", ["мтз", "mtz"]], ["Беларус", ["беларус", "belarus"], true], ["ЧТЗ", ["чтз"]], ["ЮМЗ", ["юмз"]], ["Амкодор", ["амкодор", "amkodor"]],
];
const PARTS = [["двигатель", /двигател/], ["стартер", /стартер/], ["генератор", /генератор/], ["КПП", /\bкпп\b|коробк[а-яё]* передач/], ["сцепление", /сцеплен/], ["тормоза", /тормоз/], ["подвеска", /подвеск|рессор/], ["радиатор", /радиатор/], ["турбина", /турбин/], ["форсунки", /форсунк/], ["насос", /насос/], ["гидроцилиндр", /гидроцилиндр/], ["ковш", /\bковш/], ["шины", /\bшин[аыуе]\b|\bколес/], ["аккумулятор", /аккумулятор/], ["редуктор", /редуктор/], ["мост", /\bмост[аеу]?\b/], ["рулевое", /рулев/]];
const ORG = /(^|\s)(отдел|управлени|дирекци|цех|участок|гараж|база|филиал|ао|ооо|пао|зао|мастерск|бригад|колонн)/i;
const PLACE = /(^|\s)(г\.|ул\.|п\.)|(^|\s)(район|област|край|посёл|посел|город|деревн|площадк|трасс)/;
const SERIES = /(?<![А-Яа-яA-Za-z])(ДТ|ДЗ|ЭО|КС|МКСМ|Т)[-\s]?(\d{2,5}[А-Яа-я]?)(?![\dA-Za-zА-Яа-я])/g;
const PLATE = /(?<![А-ЯA-Zа-яa-z0-9])([АВЕКМНОРСТУХABEKMHOPCTYX])\s?(\d{3})\s?([АВЕКМНОРСТУХABEKMHOPCTYX]{2})\s?(\d{2,3})(?!\d)/giu;
const VIN = /(?<![A-Za-z0-9])(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}(?![A-Za-z0-9])/gi;
const INV = /инв(?:ентарн\w*)?\.?\s*(?:номер\w*|№|N)?\s*[:№]?\s*(\d[\d\-/]{2,12})/gi;
const MODEL = /^[\s\-]*((?:[A-Za-zА-Яа-я]{1,3}[\s-]?)?\d{2,6}[A-Za-zА-Яа-я]?(?:-\d{1,3})?)(?![\dA-Za-zА-Яа-я])/;

export const plateNorm = (a, d, b, r) => (lat2cyr(a) + d + b.split("").map(lat2cyr).join("") + r).toUpperCase();
const brandFor = (word) => { const w = word.toLowerCase(); for (const [canon, al, strict] of BRANDS) if (al.includes(w)) return { canon, strict: Boolean(strict), upper: word === word.toUpperCase() }; return null; };
const modelCode = (m) => m.trim().replace(/\s+/g, "").toUpperCase().replace(/^([A-ZА-Я]{1,3})(\d)/, "$1$2");

/** Всё, что в тексте похоже на технику: [{ name, type, parent? (имя марки), part? }]. */
export function detect(text) {
  const t = String(text ?? ""), out = [], seen = new Set(), add = (o) => { const k = o.type + ":" + o.name; if (!seen.has(k)) { seen.add(k); out.push(o); } };
  // марка + модель
  const wre = /(?<![A-Za-zА-Яа-яЁё0-9])([A-Za-zА-Яа-яЁё]{2,12})(?![A-Za-zА-Яа-яЁё0-9])/g; let m;
  while ((m = wre.exec(t))) {
    const b = brandFor(m[1]); if (!b) continue;
    const mm = MODEL.exec(t.slice(m.index + m[1].length, m.index + m[1].length + 18));
    if (mm) { add({ name: b.canon, type: "brand" }); add({ name: `${b.canon} ${modelCode(mm[1])}`, type: "model", parent: b.canon }); }
    else if (!b.strict || b.upper) add({ name: b.canon, type: "brand" });
  }
  let s; SERIES.lastIndex = 0; while ((s = SERIES.exec(t))) add({ name: `${s[1]}-${s[2].toUpperCase()}`, type: "model" });
  PLATE.lastIndex = 0; while ((s = PLATE.exec(t))) add({ name: plateNorm(s[1], s[2], s[3], s[4]), type: "plate" });
  VIN.lastIndex = 0; while ((s = VIN.exec(t))) add({ name: s[0].toUpperCase(), type: "vin" });
  INV.lastIndex = 0; while ((s = INV.exec(t))) add({ name: "инв. " + s[1], type: "inv" });
  const low = t.toLowerCase(); for (const [name, re] of PARTS) if (re.test(low)) add({ name, type: "part" });
  return out;
}

/** Приведение имени сущности (от модели) к каноническому виду и типу. null — обычное имя. */
export function classify(name) {
  const t = String(name ?? "").trim(); if (!t) return null;
  { const c = contracts.classify(t); if (c) return c; }
  const pr = { model: 0, plate: 1, vin: 2, inv: 3, brand: 4 }, flat = (x) => x.replace(/[\s\-]/g, "").toLowerCase();
  const d = detect(t).filter((x) => x.type !== "part").sort((a, b) => pr[a.type] - pr[b.type])[0];
  if (d && (d.type === "plate" || d.type === "vin" || d.type === "inv" || flat(d.name) === flat(t) || d.name.length >= flat(t).length - 2)) return d;
  const P = "(ович|евич|ич|овна|евна|ична)";
  if (new RegExp(`^[А-ЯЁ][а-яё]+ [А-ЯЁ]\\.( ?[А-ЯЁ]\\.)?$`).test(t) || new RegExp(`^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+${P}$`).test(t) || new RegExp(`^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+${P}$`).test(t) || new RegExp(`^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+${P} [А-ЯЁ][а-яё]+$`).test(t)) return { name: t, type: "person" };
  if (ORG.test(t)) return { name: t, type: "org" };
  if (PLACE.test(t)) return { name: t, type: "place" };
  return null;
}
export const TYPE_LABEL = { brand: "марка", model: "модель", plate: "госномер", vin: "VIN", inv: "инв. номер", part: "узел", person: "человек", org: "подразделение", place: "место", contract: "договор", addendum: "доп. соглашение", act: "акт", invoice: "счёт", party: "контрагент" };
/** Единица техники: то, к чему цепляются события. */
export const isUnit = (type) => type === "plate" || type === "vin" || type === "inv";
