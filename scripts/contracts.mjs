// Договоры: номера, допсоглашения, акты, счета, контрагенты, роли, суммы и сроки. Чистые функции без базы.
const KW = [
  ["contract", /^(договор|контракт)/i], ["addendum", /^(доп\w*\.?\s*соглашени|д\/с|дс\b)/i], ["act", /^акт/i], ["invoice", /^(счёт|счет|накладн|упд)/i],
];
const LABEL = { contract: "договор", addendum: "доп. соглашение", act: "акт", invoice: "счёт" };
const NUM = "([0-9][0-9A-Za-zА-Яа-я\\-\\/]{0,14})";
const WORD = "(договор[а-яё]*|контракт[а-яё]*|доп[а-яё]*\\.?\\s*соглашени[а-яё]*|д\\/с|акт[а-яё]*|счёт[а-яё]*|счет[а-яё]*|накладн[а-яё]*|упд)";
const WITH_SIGN = new RegExp(WORD + "((?:\\s+[а-яё\\-]+){0,3}?)\\s*(?:№|N|no\\.?)\\s*" + NUM, "gi");
const NO_SIGN = new RegExp(WORD + "\\s+" + NUM, "gi");
const ORGS = /(ООО|АО|ПАО|ЗАО|ОАО|МУП|ГУП|ФГУП|НКО)\s*[«"“]([^»"”\n]{2,34})[»"”]/g;
const IP = /(?<![А-Яа-яA-Za-z])ИП\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.|\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)?)/g;
const ROLES = [["заказчик", /заказчик\w*/i], ["исполнитель", /исполнител\w*/i], ["поставщик", /поставщик\w*/i], ["подрядчик", /подрядчик\w*/i], ["покупатель", /покупател\w*/i], ["ответственный", /ответственн\w*/i]];
const PERSON = /[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+(?:ович|евич|овна|евна|ична))?/;
const MONEY = /(\d{1,3}(?:[\s ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(тыс\.?|млн\.?|млрд\.?)?\s*(?:руб\w*|₽|р\b\.?)/gi;
const TERM = /(?:срок[а-яё ]{0,15}|действует|действителен|действие)\s*(?:до\s*)?(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/i;

const numNorm = (n) => n.replace(/[\s]+/g, "").toUpperCase().replace(/[.,;:]+$/, "");
const kindOf = (w) => { for (const [k, re] of KW) if (re.test(w.trim())) return k; return null; };
const iso = (d, m, y, now = new Date()) => {
  let yy = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : now.getUTCFullYear(), dt = new Date(Date.UTC(yy, Number(m) - 1, Number(d), 12));
  if (!y && dt < now) dt = new Date(Date.UTC(yy + 1, Number(m) - 1, Number(d), 12));
  return Number.isNaN(dt.getTime()) || Number(m) > 12 || Number(d) > 31 ? null : dt.toISOString().slice(0, 10);
};

/** Название документа в каноническом виде: «договор №45/2026». */
export const docName = (type, num) => `${LABEL[type]} №${numNorm(num)}`;

/** Что в тексте относится к договорам: документы, контрагенты, роли, суммы, срок. */
export function detect(text) {
  const t = String(text ?? ""), items = [], seen = new Set(), parties = [], roles = [];
  const add = (type, num, parent) => { const name = docName(type, num); if (!seen.has(name)) { seen.add(name); items.push({ name, type, num: numNorm(num) }); } };
  let m; WITH_SIGN.lastIndex = 0; NO_SIGN.lastIndex = 0;
  while ((m = WITH_SIGN.exec(t))) { const k = kindOf(m[1]); if (k) add(k, m[3]); }
  while ((m = NO_SIGN.exec(t))) { const k = kindOf(m[1]); if (k && /[\/\-]|\d{2,}/.test(m[2])) add(k, m[2]); }
  const pseen = new Set(), addP = (name) => { if (!pseen.has(name)) { pseen.add(name); parties.push({ name: name.slice(0, 40), type: "party", at: t.indexOf(name) }); } };
  ORGS.lastIndex = 0; while ((m = ORGS.exec(t))) addP(`${m[1]} «${m[2].trim()}»`);
  IP.lastIndex = 0; while ((m = IP.exec(t))) addP(`ИП ${m[1].trim()}`);
  for (const [role, re] of ROLES) {
    const r = re.exec(t); if (!r) continue;
    const tail = t.slice(r.index + r[0].length, r.index + r[0].length + 70);
    const p = parties.map((x) => ({ x, i: tail.indexOf(x.name.replace(/^(ООО|АО|ПАО|ЗАО|ОАО|МУП|ГУП|ФГУП|НКО)\s*/, "").slice(0, 8)) })).filter((o) => o.i >= 0).sort((a, b) => a.i - b.i)[0];
    if (role !== "ответственный" && p) roles.push({ role, target: p.x.name, type: "party" });
    else if (role === "ответственный") { const pm = PERSON.exec(tail); if (pm) roles.push({ role, target: pm[0].replace(/\s+/g, " ").trim(), type: "person" }); }
    else { const pm = PERSON.exec(tail); if (pm && /^(\W{0,4})$/.test(tail.slice(0, pm.index).replace(/[\s—\-:,]/g, ""))) roles.push({ role, target: pm[0].replace(/\s+/g, " ").trim(), type: "person" }); }
  }
  const amounts = []; MONEY.lastIndex = 0;
  while ((m = MONEY.exec(t))) {
    const mult = /тыс/i.test(m[3] ?? "") ? 1e3 : /млн/i.test(m[3] ?? "") ? 1e6 : /млрд/i.test(m[3] ?? "") ? 1e9 : 1, v = (Number(m[1].replace(/[\s ]/g, "")) + (m[2] ? Number("0." + m[2]) : 0)) * mult;
    const before = t.slice(Math.max(0, m.index - 45), m.index).toLowerCase();
    amounts.push({ kind: /оплат|оплач|заплат|перечисл|аванс|внесл/.test(before) ? "paid" : /остат|осталось|долг/.test(before) ? "remain" : "total", value: Math.round(v * 100) / 100 });
  }
  const tm = TERM.exec(t), term = tm ? iso(tm[1], tm[2], tm[3]) : null;
  return { items, parties, roles, amounts, term };
}

/** Имя сущности от модели → документ или контрагент в каноническом виде; null — обычное имя. */
export function classify(name) {
  const t = String(name ?? "").trim(); if (!t) return null;
  const d = detect(t);
  if (d.items.length === 1 && t.replace(/[\s№]/g, "").length <= d.items[0].name.replace(/[\s№]/g, "").length + 6) return { name: d.items[0].name, type: d.items[0].type };
  if (d.parties.length === 1 && t.replace(/[«»"\s]/g, "").length <= d.parties[0].name.replace(/[«»"\s]/g, "").length + 1) return { name: d.parties[0].name, type: "party" };
  return null;
}
export const LABELS = { contract: "договор", addendum: "доп. соглашение", act: "акт", invoice: "счёт", party: "контрагент" };
/** Различаются ли ключи одной правкой (подстановка, вставка, перестановка соседних): «45/2026» и «54/2026». */
export function near1(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) { let d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i); return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]); }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]; let i = 0; while (i < s.length && s[i] === l[i]) i++; return s.slice(i) === l.slice(i + 1);
}
