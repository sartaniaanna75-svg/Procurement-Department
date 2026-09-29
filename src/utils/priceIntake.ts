import type { ColumnLabels, ColumnMapper, PriceTuple } from "../types";
import { extractPriceRows } from "./mapping";
import type { WorkbookSheet } from "./parseFile";
import { parsePrice } from "./parseFile";
import { normalizeText } from "./text";

export interface PriceIntakeResult {
  status: "ready" | "review";
  reason: string;
  rows: PriceTuple[];
  mapper: ColumnMapper;
  matrix: string[][];
  sheetName: string;
}

type Role = keyof ColumnLabels;

const ROLES: Role[] = ["name", "price", "barcode", "stock", "unit", "pack", "multiplicity"];

const HEADER_PATTERNS: Record<Role, RegExp> = {
  name: /наимен|назван|номенклат|продукц|товар|product|goods|^name$/,
  price: /цена|стоим|price|прайс/,
  barcode: /штрих|(^|\s)шк($|\s)|ean|gtin|barcode|баркод/,
  stock: /остат|налич|колич|кол-во|qty|stock|доступн/,
  unit: /единиц|ед\.?\s*изм|^ед$/,
  pack: /упаков|фасов|pack|спайк/,
  multiplicity: /кратн|квант/,
};

const CODE_HEADER = /артикул|(^|\s)код($|\s)|sku/;

function headerRole(header: string): Role | null {
  const value = normalizeText(header);
  if (!value) return null;
  if (HEADER_PATTERNS.barcode.test(value)) return "barcode";
  if (HEADER_PATTERNS.price.test(value) && !HEADER_PATTERNS.stock.test(value)) return "price";
  if (HEADER_PATTERNS.stock.test(value)) return "stock";
  if (HEADER_PATTERNS.pack.test(value)) return "pack";
  if (HEADER_PATTERNS.multiplicity.test(value)) return "multiplicity";
  if (HEADER_PATTERNS.unit.test(value)) return "unit";
  if (CODE_HEADER.test(value)) return null;
  if (HEADER_PATTERNS.name.test(value)) return "name";
  return null;
}

function isCodeHeader(header: string): boolean {
  const value = normalizeText(header);
  if (!value || HEADER_PATTERNS.barcode.test(value)) return false;
  return CODE_HEADER.test(value);
}

function isBarcode(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(compact);
}

function isUnitCell(value: string): boolean {
  const compact = normalizeText(value).replace(/\./g, "").replace(/\s+/g, "");
  return /^(шт|штука|штуки|штук|кг|килограмм|г|гр|грамм|л|литр|мл|упак|уп|упаковка|м|см|pcs|kg|g|l|ml|pack)$/.test(compact);
}

function isProductName(value: string): boolean {
  const text = value.trim();
  if (text.length < 4 || isBarcode(text) || isUnitCell(text)) return false;
  if (parsePrice(text) !== null && !/\p{L}/u.test(text)) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters >= 3;
}

function nonempty(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function ratio(values: string[], accept: (value: string) => boolean): number {
  const cells = nonempty(values);
  if (cells.length === 0) return 0;
  return cells.filter(accept).length / cells.length;
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
    const price = parsePrice(value);
    if (price === null) continue;
    if (/[.,]\d/.test(value) || price >= 30) score += 1;
    else if (price > 0) score += 0.35;
  }
  return score / cells.length;
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
  if (role === "name") return ratio(values, isProductName);
  if (role === "price") return priceRatio(values);
  if (role === "barcode") return ratio(values, isBarcode);
  if (role === "stock") return stockRatio(values);
  if (role === "unit") return ratio(values, isUnitCell);
  if (role === "pack") return packRatio(values);
  return multiplicityRatio(values);
}

function scoreColumn(role: Role, header: string, values: string[]): number {
  if (isCodeHeader(header)) return 0;
  const headerHit = headerRole(header) === role ? 6 : 0;
  const content = contentRatio(role, values);
  const minimumContent = role === "name" || role === "price" ? 0.55 : 0.65;
  const contentScore = content >= minimumContent ? content * 8 : 0;
  if (role === "price" && headerRole(header) === "stock") return 0;
  if (role === "stock" && headerRole(header) === "price") return 0;
  if (role === "unit" && headerRole(header) === "pack") return 0;
  return headerHit + contentScore;
}

interface Rank {
  index: number;
  score: number;
  second: number;
}

function rankRole(role: Role, headers: string[], matrix: string[][], dataStart: number, width: number): Rank {
  let best = -1;
  let score = 0;
  let second = 0;
  for (let column = 0; column < width; column += 1) {
    const value = scoreColumn(role, headers[column] ?? "", columnValues(matrix, dataStart, column));
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
  const labels: ColumnLabels = {
    name: label("name"),
    price: label("price"),
    barcode: label("barcode"),
    stock: label("stock"),
    unit: label("unit"),
    pack: label("pack"),
    multiplicity: label("multiplicity"),
  };
  return {
    headerRow: headerIndex < 0 ? 0 : headerIndex + 1,
    name: indexOf("name"),
    price: indexOf("price"),
    barcode: indexOf("barcode"),
    code: -1,
    unit: indexOf("unit"),
    stock: indexOf("stock"),
    pack: indexOf("pack"),
    multiplicity: indexOf("multiplicity"),
    labels,
    headerSignature: headerIndex < 0 ? [] : headers.map((cell) => normalizeText(cell)),
  };
}

const REQUIRED_MIN = 5;
const OPTIONAL_MIN = 4.5;

function chooseRoles(headers: string[], matrix: string[][], dataStart: number): { mapper: ColumnMapper; reasons: string[] } {
  const width = Math.max(widthOf(matrix, dataStart), headers.length);
  const reasons: string[] = [];
  const chosen: Partial<Record<Role, number>> = {};
  const used = new Set<number>();

  for (const role of ROLES) {
    const ranked = rankRole(role, headers, matrix, dataStart, width);
    const minimum = role === "name" || role === "price" ? REQUIRED_MIN : OPTIONAL_MIN;
    const blocked = ranked.index >= 0 && used.has(ranked.index);
    const ambiguous = ranked.second >= minimum && ranked.second >= ranked.score * 0.85;
    if (ranked.score < minimum || ranked.index < 0 || blocked || ambiguous) {
      if (role === "name" || role === "price") {
        reasons.push(
          ambiguous
            ? `Не удалось надёжно определить колонку с ${role === "name" ? "наименованием" : "ценой"}.`
            : `Не удалось определить колонку с ${role === "name" ? "наименованием" : "ценой"}.`,
        );
      }
      continue;
    }
    chosen[role] = ranked.index;
    used.add(ranked.index);
  }

  return { mapper: buildMapper(dataStart - 1, headers, chosen), reasons };
}

function rowHasKeyword(row: string[]): boolean {
  return row.some((cell) => headerRole(cell) !== null);
}

interface SheetDetection {
  mapper: ColumnMapper;
  reasons: string[];
  score: number;
  rows: PriceTuple[];
}

function detectSheet(matrix: string[][], supplier: string, fileName: string): SheetDetection {
  let best: SheetDetection | null = null;
  const limit = Math.min(matrix.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] ?? [];
    if (row.filter((cell) => cell.trim()).length < 2) continue;
    if (!rowHasKeyword(row) && index < limit - 1 && matrix.slice(index + 1, index + 4).some(rowHasKeyword)) continue;
    const decision = chooseRoles(row, matrix, index + 1);
    const extracted = tryExtract(matrix, decision.mapper, supplier, fileName);
    const score = (decision.mapper.name >= 0 ? 5 : 0) + (decision.mapper.price >= 0 ? 5 : 0) + extracted.length;
    const candidate = { ...decision, score, rows: extracted };
    if (!best || candidate.score > best.score) best = candidate;
  }

  const headerless = chooseRoles([], matrix, 0);
  const headerlessRows = tryExtract(matrix, headerless.mapper, supplier, fileName);
  const headerlessScore = (headerless.mapper.name >= 0 ? 4 : 0) + (headerless.mapper.price >= 0 ? 4 : 0) + headerlessRows.length;
  if (!best || (headerless.reasons.length === 0 && headerlessScore > best.score)) {
    best = { ...headerless, score: headerlessScore, rows: headerlessRows };
  }
  return (
    best ?? {
      mapper: buildMapper(-1, [], {}),
      reasons: ["Не удалось определить колонку с наименованием.", "Не удалось определить колонку с ценой."],
      score: 0,
      rows: [],
    }
  );
}

function tryExtract(matrix: string[][], mapper: ColumnMapper, supplier: string, fileName: string): PriceTuple[] {
  if (mapper.name < 0 || mapper.price < 0) return [];
  try {
    return extractPriceRows(matrix, mapper, supplier, fileName, -1);
  } catch {
    return [];
  }
}

function signatureKey(headers: string[]): string {
  return headers.map((cell) => normalizeText(cell)).filter(Boolean).join("|");
}

function relocate(matrix: string[][], saved: ColumnMapper): { matrix: string[][]; mapper: ColumnMapper } | null {
  const expected = signatureKey(saved.headerSignature);
  if (!expected || !saved.labels.name || !saved.labels.price) return null;
  for (let index = 0; index < matrix.length; index += 1) {
    const header = matrix[index] ?? [];
    if (signatureKey(header) !== expected) continue;
    const find = (label: string) => (label ? header.findIndex((cell) => normalizeText(cell) === label) : -1);
    const mapper = buildMapper(index, header, {
      name: find(saved.labels.name),
      price: find(saved.labels.price),
      barcode: find(saved.labels.barcode),
      stock: find(saved.labels.stock),
      unit: find(saved.labels.unit),
      pack: find(saved.labels.pack),
      multiplicity: find(saved.labels.multiplicity),
    });
    if (mapper.name < 0 || mapper.price < 0) return null;
    const names = columnValues(matrix, index + 1, mapper.name);
    const prices = columnValues(matrix, index + 1, mapper.price);
    if (ratio(names, isProductName) < 0.4 || priceRatio(prices) < 0.4) return null;
    return { matrix, mapper };
  }
  return null;
}

function reviewReason(reasons: string[], rows: PriceTuple[]): string {
  if (rows.length === 0 && reasons.length === 0) return "Не удалось определить колонку с наименованием. Не удалось определить колонку с ценой.";
  if (rows.length === 0) {
    const unique = [...new Set(reasons)];
    return unique.length > 0 ? unique.join(" ") : "В распознанных колонках нет строк с наименованием и ценой.";
  }
  return [...new Set(reasons)].join(" ");
}

/**
 * Единая точка загрузки прайса. Её же сможет вызвать агент, который принесёт файл из почты:
 * на вход уже разобранные листы, имя поставщика и ранее сохранённая структура.
 */
export function ingestPriceSource(
  sheets: WorkbookSheet[],
  supplier: string,
  fileName: string,
  saved: ColumnMapper | null,
): PriceIntakeResult {
  if (saved) {
    for (const sheet of sheets) {
      const bound = relocate(sheet.matrix, saved);
      if (!bound) continue;
      const rows = tryExtract(bound.matrix, bound.mapper, supplier, fileName);
      if (rows.length === 0) continue;
      return { status: "ready", reason: "", rows, mapper: bound.mapper, matrix: bound.matrix, sheetName: sheet.name };
    }
  }

  const detected = sheets.map((sheet) => ({ sheet, detection: detectSheet(sheet.matrix, supplier, fileName) }));
  detected.sort((a, b) => b.detection.score - a.detection.score);
  const readySheets = detected.filter((item) => item.detection.reasons.length === 0 && item.detection.rows.length > 0);
  if (readySheets.length > 0) {
    const best = readySheets[0];
    return {
      status: "ready",
      reason: "",
      rows: readySheets.flatMap((item) => item.detection.rows),
      mapper: best.detection.mapper,
      matrix: best.sheet.matrix,
      sheetName: best.sheet.name,
    };
  }
  const winner = detected[0];
  if (!winner) {
    const mapper = buildMapper(-1, [], {});
    return {
      status: "review",
      reason: "Не удалось определить колонку с наименованием. Не удалось определить колонку с ценой.",
      rows: [],
      mapper,
      matrix: [],
      sheetName: "",
    };
  }
  const { detection, sheet } = winner;
  return {
    status: "review",
    reason: `Требует проверки. ${reviewReason(detection.reasons, detection.rows)}`,
    rows: detection.rows,
    mapper: detection.mapper,
    matrix: sheet.matrix,
    sheetName: sheet.name,
  };
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
    stock: mapper.stock,
    unit: mapper.unit,
    pack: mapper.pack,
    multiplicity: mapper.multiplicity,
  });
}
