import type { ColumnMapper, IsoWeekday, OfferSource, OneCLink, PurchaseMode, SupplierCard, SupplierSchedule } from "../types";
import type { LoadedPriceFile } from "./parseFile";
import { normalizeText, supplierKey } from "./text";

export const WEEKDAYS: Array<{ id: IsoWeekday; short: string; label: string }> = [
  { id: 1, short: "Пн", label: "Понедельник" },
  { id: 2, short: "Вт", label: "Вторник" },
  { id: 3, short: "Ср", label: "Среда" },
  { id: 4, short: "Чт", label: "Четверг" },
  { id: 5, short: "Пт", label: "Пятница" },
  { id: 6, short: "Сб", label: "Суббота" },
  { id: 7, short: "Вс", label: "Воскресенье" },
];

const GENERIC_FILE = /^(прайс|прайслист|price|prices|опт|опт\d*|спец|предложение)$/i;

export function emptyOneC(): OneCLink {
  return {
    name: "",
    guid: "",
    partner: "",
    partnerGuid: "",
    counterparty: "",
    counterpartyGuid: "",
    agreement: "",
    agreementGuid: "",
    contract: "",
    contractGuid: "",
    organization: "",
    organizationGuid: "",
  };
}

export function emptySchedule(): SupplierSchedule {
  return {
    expectFrom: null,
    expectTo: null,
    deadlineWeekday: null,
    deadlineTime: "",
    validityDays: null,
    reminders: [],
  };
}

export const OFFER_SOURCES: Array<{ id: OfferSource; label: string }> = [
  { id: "price", label: "Прайс" },
  { id: "site", label: "Сайт / личный кабинет" },
  { id: "manual", label: "Ручной" },
  { id: "api", label: "API / интеграция" },
];

export const PURCHASE_MODES: Array<{ id: PurchaseMode; label: string }> = [
  { id: "schedule", label: "По графику" },
  { id: "demand", label: "По потребности" },
  { id: "manual", label: "Ручной" },
  { id: "mixed", label: "По графику + внепланово по потребности" },
];

export function createSupplier(name: string, id = ""): SupplierCard {
  return {
    id: id || `sup-${crypto.randomUUID()}`,
    name: name.trim(),
    fullName: "",
    comment: "",
    active: true,
    responsible: "",
    orderDays: [],
    offerSource: "price",
    purchaseMode: "schedule",
    aliases: [],
    priceNames: [],
    emails: [],
    inns: [],
    fileHints: [],
    sheetHints: [],
    structureHint: "",
    oneC: emptyOneC(),
    schedule: emptySchedule(),
  };
}

export function offerSourceLabel(source: OfferSource): string {
  return OFFER_SOURCES.find((item) => item.id === source)?.label ?? OFFER_SOURCES[0].label;
}

export function purchaseModeLabel(mode: PurchaseMode): string {
  return PURCHASE_MODES.find((item) => item.id === mode)?.label ?? PURCHASE_MODES[0].label;
}

export function scheduleUsesDays(mode: PurchaseMode): boolean {
  return mode === "schedule" || mode === "mixed";
}

export function weekdayLabel(day: IsoWeekday): string {
  return WEEKDAYS.find((item) => item.id === day)?.label ?? "";
}

export function orderDaysLabel(days: IsoWeekday[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => weekdayLabel(day))
    .join(", ");
}

/** Связь с 1С держится на GUID, а не на текстовом названии. */
export function oneCReady(card: SupplierCard): boolean {
  const link = card.oneC;
  return [link.guid, link.partnerGuid, link.counterpartyGuid, link.agreementGuid, link.contractGuid, link.organizationGuid].every(
    (value) => value.trim().length > 0,
  );
}

export function oneCStatusLabel(card: SupplierCard): string {
  return oneCReady(card) ? "Связь с 1С настроена" : "Требуется настройка 1С";
}

export function canSendOrderToOneC(card: SupplierCard | undefined): boolean {
  return Boolean(card && oneCReady(card));
}

export interface SupplierSignals {
  fileName: string;
  email: string;
  companyNames: string[];
  inns: string[];
  sheetNames: string[];
  structureHint: string;
}

export interface SupplierGuess {
  supplierId: string | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

function compact(value: string): string {
  return normalizeText(value).replace(/[^a-zа-яё0-9]+/gi, " ").trim();
}

function includesText(haystack: string, needle: string): boolean {
  const left = compact(haystack);
  const right = compact(needle);
  return right.length >= 3 && left.includes(right);
}

export function collectSignals(fileName: string, files: LoadedPriceFile[], email = ""): SupplierSignals {
  const companyNames: string[] = [];
  const inns: string[] = [];
  const sheetNames: string[] = [];
  let structureHint = "";
  for (const file of files) {
    for (const sheet of file.sheets) {
      if (sheet.name.trim()) sheetNames.push(sheet.name.trim());
      if (!structureHint) structureHint = tableHint(sheet.matrix);
      for (const row of sheet.matrix.slice(0, 20)) {
        const line = row.map((cell) => cell.trim()).filter(Boolean).join(" ");
        if (!line) continue;
        const inn = line.match(/инн\D*(\d{10}|\d{12})/i);
        if (inn) inns.push(inn[1]);
        if (/(ооо|зао|пао|ао\b|ип\b|общество)/i.test(line) && line.length <= 140) companyNames.push(line);
      }
    }
  }
  return {
    fileName,
    email: email.trim().toLowerCase(),
    companyNames: unique(companyNames),
    inns: unique(inns),
    sheetNames: unique(sheetNames),
    structureHint,
  };
}

function tableHint(matrix: string[][]): string {
  for (const row of matrix.slice(0, 25)) {
    const cells = row.map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (!cells.some((cell) => /цена|наимен|номенклат|прайс/i.test(cell))) continue;
    return cells.map((cell) => normalizeText(cell)).join("|");
  }
  return "";
}

export function detectSupplier(signals: SupplierSignals, suppliers: SupplierCard[], mappers: Record<string, ColumnMapper> = {}): SupplierGuess {
  const ranked = suppliers
    .map((card) => scoreSupplier(card, signals, mappers[supplierKey(card.name)]))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const leader = ranked[0];
  const second = ranked[1]?.score ?? 0;
  if (!leader || leader.score < 3) return { supplierId: null, confidence: "low", reasons: [] };
  const gap = leader.score - second;
  if (leader.score >= 6 && gap >= 2) return { supplierId: leader.card.id, confidence: "high", reasons: leader.reasons };
  if (leader.score >= 3 && gap >= 1) return { supplierId: leader.card.id, confidence: "medium", reasons: leader.reasons };
  return { supplierId: null, confidence: "low", reasons: leader.reasons };
}

function scoreSupplier(
  card: SupplierCard,
  signals: SupplierSignals,
  mapper: ColumnMapper | undefined,
): { card: SupplierCard; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const names = unique([card.name, card.fullName, ...card.aliases, ...card.priceNames]);
  if (signals.email && card.emails.some((email) => email.toLowerCase() === signals.email)) {
    score += 6;
    reasons.push("email отправителя");
  }
  if (signals.inns.some((inn) => card.inns.includes(inn))) {
    score += 6;
    reasons.push("ИНН");
  }
  if (names.some((name) => signals.companyNames.some((company) => includesText(company, name) || includesText(name, company)))) {
    score += 5;
    reasons.push("название в файле");
  }
  if (names.some((name) => includesText(signals.fileName, name))) {
    score += 3;
    reasons.push("название файла");
  }
  if (card.fileHints.some((hint) => includesText(signals.fileName, hint))) {
    score += 3;
    reasons.push("знакомый файл");
  }
  if (card.sheetHints.some((hint) => signals.sheetNames.some((sheet) => includesText(sheet, hint)))) {
    score += 2;
    reasons.push("лист");
  }
  const structure = card.structureHint || (mapper?.headerSignature ?? []).map((cell) => normalizeText(cell)).filter(Boolean).join("|");
  if (structure && signals.structureHint && structure === signals.structureHint) {
    score += 4;
    reasons.push("структура прайса");
  }
  return { card, score, reasons };
}

export function rememberSignals(card: SupplierCard, signals: SupplierSignals, structureHint = ""): SupplierCard {
  const known = unique([card.name, card.fullName, ...card.aliases, ...card.priceNames]);
  const priceNames = [...card.priceNames];
  for (const company of signals.companyNames) {
    const text = company.trim();
    if (!text || known.some((name) => includesText(name, text) || includesText(text, name))) continue;
    priceNames.push(text);
    known.push(text);
  }
  const fileHint = distinctiveStem(signals.fileName);
  const fileHints = fileHint && !card.fileHints.some((hint) => includesText(hint, fileHint)) ? [...card.fileHints, fileHint] : card.fileHints;
  const sheetHints = unique([...card.sheetHints, ...signals.sheetNames.filter((name) => !/^лист\s*\d*$/i.test(name))]);
  return {
    ...card,
    priceNames,
    emails: signals.email ? unique([...card.emails, signals.email]) : card.emails,
    inns: unique([...card.inns, ...signals.inns]),
    fileHints,
    sheetHints,
    structureHint: structureHint || card.structureHint,
  };
}

function distinctiveStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const tokens = stem
    .split(/[\s._()-]+/)
    .map((token) => token.trim())
    .filter((token) => /[a-zа-яё]/i.test(token) && token.length >= 4 && !GENERIC_FILE.test(token) && !/^\d+$/.test(token));
  return tokens.join(" ");
}

export function unique(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function findSupplier(suppliers: SupplierCard[], idOrName: string): SupplierCard | undefined {
  return suppliers.find((card) => card.id === idOrName || supplierKey(card.name) === supplierKey(idOrName));
}
