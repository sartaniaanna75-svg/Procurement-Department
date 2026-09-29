import type { ColumnLabels, ColumnMapper, PriceTuple } from "../types";
import { extractPriceRows } from "./mapping";
import { loadPriceFiles, parsePrice, type WorkbookSheet } from "./parseFile";
import { normalizeText } from "./text";

export interface PriceQuestion {
  field: "price";
  prompt: string;
  options: { label: string; column: number }[];
}

export interface PriceIntakeResult {
  status: "ready" | "review";
  reason: string;
  recognized: string[];
  missing: string[];
  ignored: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
  question: PriceQuestion | null;
  rows: PriceTuple[];
  mapper: ColumnMapper;
  matrix: string[][];
  sheetName: string;
}

export interface NormalizedPriceDocument extends PriceIntakeResult {
  fileName: string;
}

type Role = keyof ColumnLabels;
type HeaderKind = Role | "volume" | "blocked";

const ROLES: Role[] = ["name", "price", "barcode", "supplierCode", "stock", "unit", "pack", "multiplicity"];

const FIELD_TITLE: Record<Role, string> = {
  name: "Наименование",
  price: "Цена",
  barcode: "Штрихкод",
  supplierCode: "Код поставщика",
  stock: "Остаток",
  unit: "Единица измерения",
  pack: "Упаковка",
  multiplicity: "Кратность",
};

function headerKind(header: string): HeaderKind | null {
  const value = normalizeText(header);
  if (!value) return null;
  if (/штрих|(^|[^a-zа-яё0-9])шк([^a-zа-яё0-9]|$)|ean|gtin|barcode|баркод/.test(value)) return "barcode";
  if (/наименование группы|название группы/.test(value)) return "blocked";
  if (/^(№|n|номер|картинка)$/.test(value) || /процент|квота|(^|[^a-zа-яё0-9])заказ([^a-zа-яё0-9]|$)|(^|[^a-zа-яё0-9])сумма([^a-zа-яё0-9]|$)/.test(value)) {
    return "blocked";
  }
  if (/наимен|назван|номенклат|^name$|продукц|(^|[^a-zа-яё0-9])описан/.test(value) && !/группы|группа товаров/.test(value)) {
    return "name";
  }
  if (/объ[её]м|\/вес|(^|[^a-zа-яё0-9])вес([^a-zа-яё0-9]|$)|volume|weight/.test(value)) return "volume";
  if (/ндс|(^|[^a-zа-яё0-9])vat([^a-zа-яё0-9]|$)/.test(value) && !/цена|стоим|прайс/.test(value)) return "blocked";
  if (/паллет|палет|pallet/.test(value)) return "blocked";
  if (/торгов|марка|(^|[^a-zа-яё0-9])тм([^a-zа-яё0-9]|$)|бренд|brand|trademark|товарн|подгрупп|категор|category|subgroup|(^|[^a-zа-яё0-9])групп([^a-zа-яё0-9]|$)|комментар|примечан|логистическ|(^|[^a-zа-яё0-9])статус([^a-zа-яё0-9]|$)/.test(value)) {
    return "blocked";
  }
  if (/скидк/.test(value) && !/цена|стоим|прайс/.test(value)) return "blocked";
  if (/код товара|артикул|(^|[^a-zа-яё0-9])sku([^a-zа-яё0-9]|$)|(^|[^a-zа-яё0-9])код([^a-zа-яё0-9]|$)/.test(value)) {
    return "supplierCode";
  }
  if (/цена|стоим|прайс|цпрайс|price|cost/.test(value)) return "price";
  if (/остат|наличи|доступн|колич|кол-во|qty|stock/.test(value)) return "stock";
  if (/кратн|квант/.test(value)) return "multiplicity";
  if (/упаков|фасов|pack|спайк/.test(value)) return "pack";
  if (/единиц|ед\.?\s*изм|^ед\.?$|(^|[^a-zа-яё0-9])unit([^a-zа-яё0-9]|$)/.test(value)) return "unit";
  if (/^name$|product|goods|(^|[^a-zа-яё0-9])товар([^a-zа-яё0-9]|$)/.test(value)) return "name";
  return null;
}

function priceTier(header: string): "working" | "reference" | "threshold" | "money" | "no" {
  const kind = headerKind(header);
  if (kind === "blocked" || kind === "volume" || (kind && kind !== "price")) return "no";
  const value = normalizeText(header);
  if (/от\s*\d+/.test(value)) return "threshold";
  if (/регулярн|рознич|закупоч|базов|старая|без скид|без\s*ндс/.test(value)) return "reference";
  if (kind === "price") return "working";
  return "money";
}

function isBarcode(value: string): boolean {
  const tokens = value.match(/\d{8,14}/g) ?? [];
  if (tokens.length === 0) return false;
  return value.replace(/\d{8,14}/g, "").replace(/[\s-]/g, "").length === 0;
}

function isUnitCell(value: string): boolean {
  const compact = normalizeText(value).replace(/\./g, "").replace(/\s+/g, "");
  return /^(шт|штука|штуки|штук|кг|килограмм|г|гр|грамм|л|литр|мл|упак|уп|упаковка|м|см|pcs|kg|g|l|ml|pack)$/.test(compact);
}

function isProductName(value: string): boolean {
  const text = value.trim();
  if (text.length < 4 || isBarcode(text) || isUnitCell(text)) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (parsePrice(text) !== null && letters === 0) return false;
  if (parsePrice(text) !== null && letters <= 6 && /руб|₽|€|\$|usd|eur/i.test(text)) return false;
  return letters >= 3;
}

function isSupplierCodeCell(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 40 || /\s/.test(text)) return false;
  if (isProductName(text) && text.length > 24) return false;
  return /^[\p{L}\p{N}./_-]+$/u.test(text);
}

function nonempty(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function ratio(values: string[], accept: (value: string) => boolean): number {
  const cells = nonempty(values);
  if (cells.length === 0) return 0;
  return cells.filter(accept).length / cells.length;
}

function uniqueness(values: string[]): number {
  const cells = nonempty(values).map((value) => normalizeText(value));
  if (cells.length === 0) return 0;
  return new Set(cells).size / cells.length;
}

function columnValues(matrix: string[][], start: number, column: number, limit = 16): string[] {
  const values: string[] = [];
  for (let index = start; index < matrix.length && values.length < limit; index += 1) {
    const cell = (matrix[index]?.[column] ?? "").trim();
    if (cell) values.push(cell);
  }
  return values;
}

function priceRatio(values: string[]): number {
  const cells = nonempty(values);
  if (cells.length === 0) return 0;
  let score = 0;
  for (const value of cells) {
    if (isBarcode(value)) continue;
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 10 && !/[.,]\d/.test(value) && !/руб|₽/.test(value)) continue;
    const price = parsePrice(value);
    if (price === null || price <= 0 || price > 10000000) continue;
    if (/[.,]\d/.test(value) || price >= 30) score += 1;
    else score += 0.35;
  }
  return score / cells.length;
}

function looksLikeVat(values: string[]): boolean {
  const cells = nonempty(values);
  if (cells.length === 0) return false;
  const rates = new Set([0, 5, 7, 10, 18, 20, 22]);
  const matched = cells.filter((value) => {
    const price = parsePrice(value.replace(/%/g, ""));
    return price !== null && rates.has(price);
  });
  return matched.length / cells.length >= 0.75 && uniqueness(values) <= 0.5;
}

function looksLikePallet(values: string[]): boolean {
  const cells = nonempty(values);
  if (cells.length < 2) return false;
  const numbers = cells
    .map((value) => parsePrice(value))
    .filter((value): value is number => value !== null && Number.isInteger(value));
  if (numbers.length / cells.length < 0.8) return false;
  const large = numbers.filter((value) => value >= 80);
  return large.length / numbers.length >= 0.7;
}

function stockRatio(values: string[]): number {
  return ratio(values, (value) => {
    if (/^(да|нет|есть|много|мало|в наличии|под заказ)$/i.test(value)) return true;
    if (isBarcode(value)) return false;
    const price = parsePrice(value);
    return price !== null && Number.isInteger(price) && price >= 0 && price <= 100000;
  });
}

function multiplicityRatio(values: string[]): number {
  return ratio(values, (value) => {
    const price = parsePrice(value);
    return price !== null && Number.isInteger(price) && price >= 1 && price <= 100 && !/[.,]\d/.test(value);
  });
}

function packRatio(values: string[]): number {
  return ratio(values, (value) => {
    if (isUnitCell(value)) return false;
    return /упак|короб|спайк|pack|фас|\d+\s*(шт|кг|г|л|мл)/i.test(value);
  });
}

function contentRatio(role: Role, values: string[]): number {
  if (role === "name") {
    const cells = nonempty(values);
    const names = cells.filter(isProductName);
    if (names.length === 0) return 0;
    const unique = new Set(names.map((value) => normalizeText(value))).size / names.length;
    const average = names.reduce((sum, value) => sum + value.length, 0) / names.length;
    const lengthBonus = Math.min(average / 28, 1);
    return (names.length / cells.length) * (0.55 + 0.45 * unique) * (0.75 + 0.25 * lengthBonus);
  }
  if (role === "price") return priceRatio(values);
  if (role === "barcode") return ratio(values, isBarcode);
  if (role === "supplierCode") return ratio(values, isSupplierCodeCell);
  if (role === "stock") return stockRatio(values);
  if (role === "unit") return ratio(values, isUnitCell);
  if (role === "pack") return packRatio(values);
  return multiplicityRatio(values);
}

function numericRatio(values: string[]): number {
  return ratio(values, (value) => {
    const price = parsePrice(value);
    return price !== null && price > 0;
  });
}

function scoreColumn(role: Role, header: string, values: string[], support: number): number {
  const kind = headerKind(header);
  if (kind === "blocked" || kind === "volume") return 0;
  if (kind && kind !== role) return 0;
  if (nonempty(values).length === 0) return 0;
  if (role === "supplierCode" && kind !== "supplierCode") return 0;
  if (role === "price" && looksLikeVat(values) && kind !== "price") return 0;
  if (role === "stock" && (looksLikePallet(values) || looksLikeVat(values)) && kind !== "stock") return 0;
  if (role === "barcode" && ratio(values, isBarcode) < 0.5) return 0;

  let content = contentRatio(role, values);
  if (role === "pack" && kind === "pack") content = Math.max(content, numericRatio(values));
  if (role === "name" && kind !== "name" && uniqueness(values) < 0.55) content = 0;
  const headerHit = kind === role ? 6 : 0;
  const minimum = headerHit > 0 ? 0.35 : role === "name" || role === "price" ? 0.55 : 0.65;
  if (content < minimum) return 0;
  return headerHit + content * 8 + support;
}

function neighborSupport(
  role: Role,
  column: number,
  headers: string[],
  matrix: string[][],
  dataStart: number,
  width: number,
): number {
  let support = 0;
  for (let other = 0; other < width; other += 1) {
    if (other === column) continue;
    const kind = headerKind(headers[other] ?? "");
    if (role === "price" && kind === "name") support += 1;
    if (role === "name" && kind === "price") support += 1;
    if ((role === "barcode" || role === "supplierCode") && (kind === "name" || kind === "price")) support += 0.5;
  }
  for (const neighbor of [column - 1, column + 1]) {
    if (neighbor < 0 || neighbor >= width) continue;
    const values = columnValues(matrix, dataStart, neighbor);
    if (role === "name" && priceRatio(values) >= 0.55) support += 1;
    if (role === "price" && ratio(values, isProductName) >= 0.55) support += 1;
  }
  return support;
}

interface Rank {
  index: number;
  score: number;
  second: number;
}

function rankRole(
  role: Role,
  headers: string[],
  matrix: string[][],
  dataStart: number,
  width: number,
  blocked: Set<number>,
): Rank {
  let best = -1;
  let score = 0;
  let second = 0;
  for (let column = 0; column < width; column += 1) {
    if (blocked.has(column)) continue;
    const value = scoreColumn(
      role,
      headers[column] ?? "",
      columnValues(matrix, dataStart, column),
      neighborSupport(role, column, headers, matrix, dataStart, width),
    );
    if (value > score) {
      second = score;
      score = value;
      best = column;
    } else if (value > second) {
      second = value;
    }
  }
  return { index: best, score, second };
}

function widthOf(matrix: string[][], from: number): number {
  return matrix.slice(from, from + 16).reduce((max, row) => Math.max(max, row.length), 0);
}

function buildMapper(headerIndex: number, headers: string[], chosen: Partial<Record<Role, number>>): ColumnMapper {
  const indexOf = (role: Role) => chosen[role] ?? -1;
  const label = (role: Role) => {
    const index = indexOf(role);
    return index >= 0 ? normalizeText(headers[index] ?? "") : "";
  };
  const used = new Set(ROLES.map((role) => indexOf(role)).filter((index) => index >= 0));
  let code = indexOf("supplierCode");
  if (code < 0) {
    code = headers.findIndex((header, index) => headerKind(header) === "supplierCode" && !used.has(index));
    if (code >= 0) used.add(code);
  }
  const volume = headers.findIndex((header, index) => headerKind(header) === "volume" && !used.has(index));
  const labels: ColumnLabels = {
    name: label("name"),
    price: label("price"),
    barcode: label("barcode"),
    stock: label("stock"),
    unit: label("unit"),
    pack: label("pack"),
    multiplicity: label("multiplicity"),
    supplierCode: code >= 0 ? normalizeText(headers[code] ?? "") : "",
  };
  return {
    headerRow: headerIndex < 0 ? 0 : headerIndex + 1,
    name: indexOf("name"),
    price: indexOf("price"),
    barcode: indexOf("barcode"),
    code,
    unit: indexOf("unit"),
    stock: indexOf("stock"),
    pack: indexOf("pack"),
    multiplicity: indexOf("multiplicity"),
    volume,
    labels,
    headerSignature: headerIndex < 0 ? [] : headers.map((cell) => normalizeText(cell)),
  };
}

const REQUIRED_MIN = 5;
const OPTIONAL_MIN = 4.5;

function headerSignals(row: string[]): number {
  return row.filter((cell) => headerKind(cell) !== null).length;
}

function choosePrice(
  headers: string[],
  matrix: string[][],
  dataStart: number,
  width: number,
  used: Set<number>,
): { index: number; question: PriceQuestion | null } {
  const candidates: { index: number; tier: "working" | "reference" | "threshold" | "money"; score: number; label: string }[] = [];
  for (let column = 0; column < width; column += 1) {
    if (used.has(column)) continue;
    const header = headers[column] ?? "";
    const tier = priceTier(header);
    if (tier === "no" && header.trim()) continue;
    const values = columnValues(matrix, dataStart, column);
    if (looksLikeVat(values) && tier !== "working") continue;
    const score = priceRatio(values);
    if (score < 0.45 || nonempty(values).length === 0) continue;
    candidates.push({ index: column, tier: tier === "no" ? "money" : tier, score, label: header.trim() || `колонка ${column + 1}` });
  }
  const usable = (tier: "working" | "reference" | "threshold" | "money") =>
    candidates.filter((item) => item.tier === tier).sort((a, b) => b.score - a.score);
  const working = usable("working");
  if (working.length === 1) return { index: working[0].index, question: null };
  if (working.length > 1) {
    const close = working.filter((item) => item.score >= working[0].score * 0.85);
    if (close.length > 1) {
      return {
        index: -1,
        question: {
          field: "price",
          prompt: `В прайсе найдено несколько возможных цен: ${close.map((item) => `«${item.label}»`).join(" и ")}. Какую использовать?`,
          options: close.map((item) => ({ label: item.label, column: item.index })),
        },
      };
    }
    return { index: working[0].index, question: null };
  }
  const reference = usable("reference");
  if (reference.length === 1) return { index: reference[0].index, question: null };
  const threshold = usable("threshold");
  if (threshold.length === 1 && reference.length === 0) return { index: threshold[0].index, question: null };
  const money = usable("money").filter((item) => item.score >= 0.55);
  const named = (items: typeof money) => items.filter((item) => item.label && !/^колонка \d+$/.test(item.label));
  if (money.length === 1) return { index: money[0].index, question: null };
  const pool = named([...reference, ...threshold, ...money]);
  if (pool.length > 1) {
    return {
      index: -1,
      question: {
        field: "price",
        prompt: `В прайсе найдено несколько возможных цен: ${pool.map((item) => `«${item.label}»`).join(" и ")}. Какую использовать?`,
        options: pool.map((item) => ({ label: item.label, column: item.index })),
      },
    };
  }
  if (money.length >= 1) return { index: money[0].index, question: null };
  return { index: -1, question: null };
}

function chooseRoles(
  headers: string[],
  matrix: string[][],
  dataStart: number,
): { mapper: ColumnMapper; reasons: string[]; question: PriceQuestion | null } {
  const width = Math.max(widthOf(matrix, dataStart), headers.length);
  const banned = new Set<number>();
  let mapper = buildMapper(dataStart - 1, headers, {});
  let reasons: string[] = [];
  let question: PriceQuestion | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const chosen: Partial<Record<Role, number>> = {};
    const used = new Set<number>(banned);
    reasons = [];
    question = null;
    for (const role of ROLES) {
      if (role === "price") {
        const priced = choosePrice(headers, matrix, dataStart, width, used);
        question = priced.question;
        if (priced.question || priced.index < 0) {
          if (!priced.question) reasons.push("Не удалось определить колонку «цена».");
          continue;
        }
        chosen.price = priced.index;
        used.add(priced.index);
        continue;
      }
      const ranked = rankRole(role, headers, matrix, dataStart, width, used);
      const minimum = role === "name" ? REQUIRED_MIN : OPTIONAL_MIN;
      const ambiguous = role === "name" && ranked.second >= minimum && ranked.second >= ranked.score * 0.85;
      if (ranked.score < minimum || ranked.index < 0 || ambiguous) {
        if (role === "name") {
          reasons.push(
            ambiguous
              ? `Не удалось надёжно отличить колонку «${FIELD_TITLE[role].toLowerCase()}» от соседней похожей колонки.`
              : `Не удалось определить колонку «${FIELD_TITLE[role].toLowerCase()}».`,
          );
        }
        continue;
      }
      chosen[role] = ranked.index;
      used.add(ranked.index);
    }
    const audited = audit(headers, matrix, dataStart, chosen);
    mapper = buildMapper(dataStart - 1, headers, audited.chosen);
    reasons = [...reasons, ...audited.problems];
    if (question || audited.reject.length === 0 || (mapper.name >= 0 && mapper.price >= 0 && audited.problems.length === 0)) break;
    for (const index of audited.reject) banned.add(index);
  }

  return { mapper, reasons: [...new Set(reasons)], question };
}

function audit(
  headers: string[],
  matrix: string[][],
  dataStart: number,
  chosen: Partial<Record<Role, number>>,
): { chosen: Partial<Record<Role, number>>; problems: string[]; reject: number[] } {
  const next = { ...chosen };
  const problems: string[] = [];
  const reject: number[] = [];
  const headerOf = (role: Role) => (next[role] !== undefined && next[role]! >= 0 ? headers[next[role]!] ?? "" : "");
  const valuesOf = (role: Role) =>
    next[role] !== undefined && next[role]! >= 0 ? columnValues(matrix, dataStart, next[role]!) : [];

  if ((next.name ?? -1) >= 0) {
    const header = headerOf("name");
    const kind = headerKind(header);
    if (kind === "blocked" || kind === "volume" || kind === "supplierCode") {
      problems.push(`Колонка «${header}» не может быть наименованием.`);
      reject.push(next.name!);
      delete next.name;
    } else if (ratio(valuesOf("name"), isProductName) < 0.4) {
      problems.push("В колонке наименования слишком мало названий товаров.");
      reject.push(next.name!);
      delete next.name;
    }
  }
  if ((next.price ?? -1) >= 0) {
    const header = headerOf("price");
    const kind = headerKind(header);
    if (kind === "blocked" || /ндс|vat/.test(normalizeText(header)) || (looksLikeVat(valuesOf("price")) && kind !== "price")) {
      problems.push(`Колонка «${header || "без названия"}» не может быть ценой.`);
      reject.push(next.price!);
      delete next.price;
    } else if (priceRatio(valuesOf("price")) < 0.35) {
      problems.push("В колонке цены слишком мало цен.");
      reject.push(next.price!);
      delete next.price;
    }
  }
  if ((next.stock ?? -1) >= 0) {
    const header = headerOf("stock");
    if (/паллет|палет|ндс|vat/.test(normalizeText(header)) || headerKind(header) === "blocked" || headerKind(header) === "volume") {
      delete next.stock;
    }
  }
  if ((next.barcode ?? -1) >= 0) {
    const header = headerOf("barcode");
    if (headerKind(header) === "supplierCode" || ratio(valuesOf("barcode"), isBarcode) < 0.5) delete next.barcode;
  }
  if ((next.unit ?? -1) >= 0 && headerKind(headerOf("unit")) !== "unit" && ratio(valuesOf("unit"), isUnitCell) < 0.5) {
    delete next.unit;
  }
  if ((next.pack ?? -1) >= 0) {
    const kind = headerKind(headerOf("pack"));
    if (kind === "blocked" || kind === "volume") delete next.pack;
  }
  return { chosen: next, problems, reject };
}

interface HeaderBand {
  headers: string[];
  dataStart: number;
}

function filledCount(row: string[]): number {
  return row.filter((cell) => cell.trim()).length;
}

function looksLikeDataRow(row: string[]): boolean {
  const barcode = row.some((cell) => isBarcode(cell));
  const priced = row.some((cell) => {
    const price = parsePrice(cell);
    return price !== null && price > 0;
  });
  const named = row.some((cell) => isProductName(cell) && cell.trim().length > 12);
  return (barcode && priced) || (named && priced);
}

function headerBand(matrix: string[][], start: number): HeaderBand {
  let headers = [...(matrix[start] ?? [])];
  let last = start;
  for (let offset = 1; offset <= 3; offset += 1) {
    const next = matrix[start + offset] ?? [];
    if (looksLikeDataRow(next)) break;
    const signals = headerSignals(next);
    if (signals === 0 && filledCount(next) > 1) break;
    if (signals === 0 && filledCount(next) === 1 && !/^(руб\.?|ед\.?|шт)$/i.test(next.find((cell) => cell.trim()) ?? "")) break;
    if (signals === 0 && filledCount(next) === 0) continue;
    const width = Math.max(headers.length, next.length);
    headers = Array.from({ length: width }, (_, index) => [headers[index] ?? "", next[index] ?? ""].map((cell) => cell.trim()).filter(Boolean).join(" "));
    last = start + offset;
  }
  return { headers, dataStart: last + 1 };
}

interface SheetDetection {
  mapper: ColumnMapper;
  reasons: string[];
  question: PriceQuestion | null;
  headers: string[];
  score: number;
  rows: PriceTuple[];
}

function findRowKind(matrix: string[][], dataStart: number, mapper: ColumnMapper): number {
  const used = new Set(
    [mapper.name, mapper.price, mapper.barcode, mapper.code, mapper.stock, mapper.unit, mapper.pack, mapper.multiplicity, mapper.volume].filter(
      (index) => index >= 0,
    ),
  );
  const width = widthOf(matrix, dataStart);
  for (let column = 0; column < width; column += 1) {
    if (used.has(column)) continue;
    const values = columnValues(matrix, dataStart, column, 24);
    if (values.length < 3) continue;
    const marks = values.filter((value) => /^(группа|строка|шапка|итог|итого)$/.test(normalizeText(value)));
    if (marks.length / values.length >= 0.5) return column;
  }
  return -1;
}

function detectSheet(matrix: string[][], supplier: string, fileName: string, levels: number[] = []): SheetDetection {
  let best: SheetDetection | null = null;
  const limit = Math.min(matrix.length, 45);
  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] ?? [];
    if (headerSignals(row) < 1) continue;
    const band = headerBand(matrix, index);
    if (headerSignals(band.headers) < 2) continue;
    const decision = chooseRoles(band.headers, matrix, band.dataStart);
    const extracted = tryExtract(matrix, decision.mapper, supplier, fileName, levels);
    const reliable = decision.mapper.name >= 0 && decision.mapper.price >= 0 && decision.reasons.length === 0 && !decision.question;
    const score = (reliable ? 20 : 0) + headerSignals(band.headers) + extracted.length;
    const candidate: SheetDetection = { ...decision, headers: band.headers, score, rows: extracted };
    if (!best || candidate.score > best.score) best = candidate;
  }

  const headerless = chooseRoles([], matrix, 0);
  const headerlessRows = tryExtract(matrix, headerless.mapper, supplier, fileName, levels);
  const headerlessReliable = headerless.mapper.name >= 0 && headerless.mapper.price >= 0 && headerless.reasons.length === 0 && !headerless.question;
  const headerlessScore = (headerlessReliable ? 12 : 0) + headerlessRows.length;
  if (!best || (headerlessReliable && headerlessScore > best.score)) {
    best = { ...headerless, headers: [], score: headerlessScore, rows: headerlessRows };
  }
  return (
    best ?? {
      mapper: buildMapper(-1, [], {}),
      reasons: ["Не удалось определить колонку «наименование».", "Не удалось определить колонку «цена»."],
      question: null,
      headers: [],
      score: 0,
      rows: [],
    }
  );
}

function tryExtract(matrix: string[][], mapper: ColumnMapper, supplier: string, fileName: string, levels: number[] = []): PriceTuple[] {
  if (mapper.name < 0 || mapper.price < 0) return [];
  try {
    return extractPriceRows(matrix, mapper, supplier, fileName, -1, {
      rowKind: findRowKind(matrix, mapper.headerRow, mapper),
      levels,
    });
  } catch {
    return [];
  }
}

function signatureKey(headers: string[]): string {
  return headers.map((cell) => normalizeText(cell)).filter(Boolean).join("|");
}

function relocate(matrix: string[][], saved: ColumnMapper): { matrix: string[][]; mapper: ColumnMapper; headers: string[] } | null {
  const expected = signatureKey(saved.headerSignature);
  if (!expected || !saved.labels.name || !saved.labels.price) return null;
  const limit = Math.min(matrix.length, 45);
  for (let index = 0; index < limit; index += 1) {
    if (headerSignals(matrix[index] ?? []) < 1) continue;
    const band = headerBand(matrix, index);
    if (signatureKey(band.headers) !== expected) continue;
    const find = (label: string) => (label ? band.headers.findIndex((cell) => normalizeText(cell) === label) : -1);
    const decision = chooseRoles(band.headers, matrix, band.dataStart);
    const rebound = buildMapper(band.dataStart - 1, band.headers, {
      name: find(saved.labels.name),
      price: find(saved.labels.price),
      barcode: find(saved.labels.barcode),
      supplierCode: find(saved.labels.supplierCode),
      stock: find(saved.labels.stock),
      unit: find(saved.labels.unit),
      pack: find(saved.labels.pack),
      multiplicity: find(saved.labels.multiplicity),
    });
    const names = columnValues(matrix, band.dataStart, rebound.name);
    const prices = columnValues(matrix, band.dataStart, rebound.price);
    const sameMeaning =
      rebound.name >= 0 &&
      rebound.price >= 0 &&
      ratio(names, isProductName) >= 0.4 &&
      priceRatio(prices) >= 0.35 &&
      !looksLikeVat(prices) &&
      priceTier(band.headers[rebound.price] ?? "") !== "no" &&
      headerKind(band.headers[rebound.name] ?? "") !== "blocked";
    if (!sameMeaning || decision.question) return null;
    if (decision.mapper.name !== rebound.name || decision.mapper.price !== rebound.price) return null;
    return { matrix, mapper: rebound, headers: band.headers };
  }
  return null;
}

function ignoredHeaders(headers: string[], mapper: ColumnMapper): string[] {
  const used = new Set(
    [mapper.name, mapper.price, mapper.barcode, mapper.code, mapper.stock, mapper.unit, mapper.pack, mapper.multiplicity, mapper.volume].filter(
      (index) => index >= 0,
    ),
  );
  const ignored: string[] = [];
  headers.forEach((header, index) => {
    const kind = headerKind(header);
    if (!header.trim() || used.has(index) || (kind !== "blocked" && kind !== "volume")) return;
    if (kind === "volume" && mapper.volume === index) return;
    ignored.push(header.trim());
  });
  return ignored;
}

function report(mapper: ColumnMapper): { recognized: string[]; missing: string[] } {
  const indexes: Record<Role, number> = {
    name: mapper.name,
    price: mapper.price,
    barcode: mapper.barcode,
    supplierCode: mapper.code,
    stock: mapper.stock,
    unit: mapper.unit,
    pack: mapper.pack,
    multiplicity: mapper.multiplicity,
  };
  const recognized: string[] = [];
  const missing: string[] = [];
  for (const role of ROLES) {
    if (indexes[role] >= 0) recognized.push(FIELD_TITLE[role]);
    else missing.push(FIELD_TITLE[role]);
  }
  return { recognized, missing };
}

function emptyResult(reason: string): PriceIntakeResult {
  const mapper = buildMapper(-1, [], {});
  return {
    status: "review",
    reason,
    recognized: [],
    missing: ["Наименование", "Цена"],
    ignored: [],
    warnings: [],
    confidence: "low",
    question: null,
    rows: [],
    mapper,
    matrix: [],
    sheetName: "",
  };
}

function finish(detection: SheetDetection, sheet: WorkbookSheet): PriceIntakeResult {
  const fields = report(detection.mapper);
  const ignored = ignoredHeaders(detection.headers, detection.mapper);
  const ready = detection.mapper.name >= 0 && detection.mapper.price >= 0 && detection.reasons.length === 0 && !detection.question && detection.rows.length > 0;
  const warnings = detection.mapper.volume >= 0 ? ["Объём или вес сохранён как дополнительный признак и не подменяет наименование."] : [];
  const unusedPrices = detection.headers.filter((header, index) => index !== detection.mapper.price && priceTier(header) !== "no" && headerKind(header) === "price");
  if (unusedPrices.length > 0) warnings.push(`Другие цены не использованы: ${unusedPrices.join(", ")}.`);
  return {
    status: ready ? "ready" : "review",
    reason: ready ? "" : detection.question?.prompt ?? `Уверенности недостаточно, чтобы сохранить прайс. ${detection.reasons.join(" ")}`.trim(),
    recognized: fields.recognized,
    missing: fields.missing,
    ignored,
    warnings,
    confidence: ready ? "high" : detection.question ? "medium" : "low",
    question: detection.question,
    rows: ready ? detection.rows : [],
    mapper: detection.mapper,
    matrix: sheet.matrix,
    sheetName: sheet.name,
  };
}

/**
 * Разбор уже извлечённых таблиц. Источник файла не важен: кнопку загрузки и почтового агента
 * обслуживает одна и та же функция normalizePriceFile.
 */
export function ingestPriceSource(
  sheets: WorkbookSheet[],
  supplier: string,
  fileName: string,
  saved: ColumnMapper | null,
): PriceIntakeResult {
  if (saved?.headerSignature?.length) {
    for (const sheet of sheets) {
      const bound = relocate(sheet.matrix, saved);
      if (!bound) continue;
      const rows = tryExtract(bound.matrix, bound.mapper, supplier, fileName, sheet.levels);
      if (rows.length === 0) continue;
      return finish(
        { mapper: bound.mapper, reasons: [], question: null, headers: bound.headers, score: rows.length, rows },
        { ...sheet, matrix: bound.matrix },
      );
    }
  }

  const detected = sheets.map((sheet) => ({ sheet, detection: detectSheet(sheet.matrix, supplier, fileName, sheet.levels) }));
  detected.sort((a, b) => b.detection.score - a.detection.score);
  const readySheets = detected.filter(
    (item) => item.detection.reasons.length === 0 && item.detection.rows.length > 0 && item.detection.mapper.name >= 0,
  );
  if (readySheets.length > 0) {
    const best = readySheets[0];
    const finished = finish(best.detection, best.sheet);
    return { ...finished, rows: readySheets.flatMap((item) => item.detection.rows) };
  }
  const winner = detected[0];
  if (!winner) return emptyResult("Не удалось найти товарную таблицу.");
  return finish(winner.detection, winner.sheet);
}

export function acceptPriceColumn(
  result: PriceIntakeResult,
  column: number,
  supplier: string,
  fileName: string,
): PriceIntakeResult {
  const mapper = { ...result.mapper, price: column };
  const rows = tryExtract(result.matrix, mapper, supplier, fileName);
  if (rows.length === 0) {
    return { ...result, status: "review", question: null, confidence: "low", reason: "В выбранной колонке нет цен.", rows: [], mapper };
  }
  return { ...result, status: "ready", question: null, confidence: "high", reason: "", rows, mapper };
}

export function normalizeLoadedPrice(
  loaded: Array<{ fileName: string; sheets: WorkbookSheet[]; unreadable: string | null }>,
  supplier: string,
  saved: ColumnMapper | null,
): NormalizedPriceDocument[] {
  return loaded.map((item) => {
    if (item.unreadable || item.sheets.length === 0) {
      const empty = emptyResult(item.unreadable ?? "Товарная таблица не найдена. Данные не придуманы.");
      return { ...empty, fileName: item.fileName };
    }
    return { ...ingestPriceSource(item.sheets, supplier, item.fileName, saved), fileName: item.fileName };
  });
}

export async function normalizePriceFile(
  file: File,
  supplier: string,
  saved: ColumnMapper | null,
): Promise<NormalizedPriceDocument[]> {
  const loaded = await loadPriceFiles(file);
  return normalizeLoadedPrice(loaded, supplier, saved);
}

export function detectionAt(matrix: string[][], headerRow: number): ColumnMapper {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > matrix.length) {
    return buildMapper(-1, matrix[0] ?? [], {});
  }
  const headers = matrix[headerRow - 1] ?? [];
  return chooseRoles(headers, matrix, headerRow).mapper;
}

export function finalizeMapper(matrix: string[][], mapper: ColumnMapper): ColumnMapper {
  const headers = mapper.headerRow > 0 ? matrix[mapper.headerRow - 1] ?? [] : [];
  return buildMapper(mapper.headerRow - 1, headers, {
    name: mapper.name,
    price: mapper.price,
    barcode: mapper.barcode,
    supplierCode: mapper.code,
    stock: mapper.stock,
    unit: mapper.unit,
    pack: mapper.pack,
    multiplicity: mapper.multiplicity,
  });
}
