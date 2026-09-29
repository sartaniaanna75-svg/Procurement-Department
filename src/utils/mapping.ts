import type { CatalogItem, ColumnMapper, PriceTuple } from "../types";
import { parsePrice } from "./parseFile";
import { matchKey } from "./rows";
import { normalizeText } from "./text";

export interface Detection {
  headerRow: number;
  mapper: ColumnMapper;
  supplierCol: number;
}

type HeaderField = "name" | "price" | "barcode" | "code" | "unit" | "supplier";

function classifyHeader(header: string): HeaderField | null {
  const value = normalizeText(header);
  if (!value) return null;
  if (/штрих|barcode|ean|gtin/.test(value)) return "barcode";
  if (/цена|стоим|price|cost/.test(value)) return "price";
  if (/единиц|ед\.?\s*изм|^ед\.?$|unit|measure/.test(value)) return "unit";
  if (/поставщик|supplier|vendor/.test(value)) return "supplier";
  if (/артикул|\bsku\b|\bcode\b|код/.test(value)) return "code";
  if (/наимен|назван|номенклат|товар|product|goods|^name$|описан/.test(value)) return "name";
  return null;
}

function detectFields(headers: string[]): { mapper: Omit<ColumnMapper, "headerRow">; supplierCol: number; score: number } {
  const found: Partial<Record<HeaderField, number>> = {};
  headers.forEach((header, index) => {
    const field = classifyHeader(header);
    if (!field || found[field] !== undefined) return;
    found[field] = index;
  });
  const mapper = {
    name: found.name ?? -1,
    price: found.price ?? -1,
    barcode: found.barcode ?? -1,
    code: found.code ?? -1,
    unit: found.unit ?? -1,
  };
  let score = 0;
  if (mapper.name >= 0) score += 2;
  if (mapper.price >= 0) score += 2;
  if (mapper.barcode >= 0) score += 1;
  if (mapper.code >= 0) score += 1;
  if (mapper.unit >= 0) score += 1;
  return { mapper, supplierCol: found.supplier ?? -1, score };
}

export function findSupplierCol(headers: string[]): number {
  return detectFields(headers).supplierCol;
}

export function detectAt(matrix: string[][], headerRow: number): Detection {
  const headers = matrix[headerRow - 1] ?? [];
  const detected = detectFields(headers);
  return {
    headerRow,
    supplierCol: detected.supplierCol,
    mapper: { ...detected.mapper, headerRow },
  };
}

export function resolveHeader(matrix: string[][], preferred: number): Detection {
  const safePreferred = Math.min(Math.max(preferred, 1), matrix.length);
  const preferredDetection = detectAt(matrix, safePreferred);
  if (preferredDetection.mapper.name >= 0 && preferredDetection.mapper.price >= 0) {
    return preferredDetection;
  }

  let best = preferredDetection;
  const limit = Math.min(matrix.length, 25);
  for (let row = 1; row <= limit; row += 1) {
    const detection = detectAt(matrix, row);
    const score = detectFields(matrix[row - 1] ?? []).score;
    const bestScore = detectFields(matrix[best.headerRow - 1] ?? []).score;
    if (score > bestScore) best = detection;
  }
  return best;
}

export function mapperFits(mapper: ColumnMapper, matrix: string[][]): boolean {
  const header = matrix[mapper.headerRow - 1];
  if (!header) return false;
  if (mapper.name < 0 || mapper.price < 0) return false;
  const indexes = [mapper.name, mapper.price, mapper.barcode, mapper.code, mapper.unit];
  return indexes.every((index) => index < header.length);
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

export function extractPriceRows(
  matrix: string[][],
  mapper: ColumnMapper,
  fallbackSupplier: string,
  fileName: string,
  supplierCol: number,
): PriceTuple[] {
  const start = mapper.headerRow;
  const unique = new Map<string, PriceTuple>();
  for (let index = start; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const name = cell(row, mapper.name);
    if (!name || /^(итог|итого|всего|total|sum)[:\s]*$/i.test(name)) continue;
    const price = parsePrice(cell(row, mapper.price));
    if (price === null) continue;
    const supplier = cell(row, supplierCol) || fallbackSupplier.trim();
    if (!supplier) continue;
    const barcode = cell(row, mapper.barcode);
    const code = cell(row, mapper.code);
    const unit = cell(row, mapper.unit);
    const tuple: PriceTuple = [supplier, name, price, barcode, code, unit, fileName];
    unique.set(matchKey(supplier, name, code, barcode, unit), tuple);
  }
  if (unique.size === 0) {
    throw new Error("Не найдено ни одной позиции с названием и ценой. Проверьте строку заголовков и колонки.");
  }
  return [...unique.values()];
}

export function columnChoicesOverlap(mapper: ColumnMapper): boolean {
  const indexes = [mapper.name, mapper.price, mapper.barcode, mapper.code, mapper.unit].filter((index) => index >= 0);
  return new Set(indexes).size !== indexes.length;
}

function catalogColumns(headers: string[]): { code: number; name: number; unit: number } | null {
  const found: Partial<Record<"code" | "name" | "unit", number>> = {};
  let barcodeFallback = -1;
  headers.forEach((header, index) => {
    const value = normalizeText(header);
    if (!value) return;
    if (/штрих|barcode|ean|gtin/.test(value)) {
      if (barcodeFallback < 0) barcodeFallback = index;
      return;
    }
    if (found.code === undefined && /артикул|код|code|sku/.test(value) && !/постав/.test(value)) found.code = index;
    else if (found.name === undefined && /наимен|назван|номенклат|товар|name/.test(value)) found.name = index;
    else if (found.unit === undefined && /единиц|ед\.?\s*изм|^ед\.?$|unit/.test(value)) found.unit = index;
  });
  if (found.code === undefined && barcodeFallback >= 0) found.code = barcodeFallback;
  if (found.code === undefined || found.name === undefined) return null;
  return { code: found.code, name: found.name, unit: found.unit ?? -1 };
}

export function parseCatalog(matrix: string[][]): CatalogItem[] {
  let headerIndex = -1;
  let columns: { code: number; name: number; unit: number } | null = null;
  const scanLimit = Math.min(matrix.length, 10);
  for (let index = 0; index < scanLimit; index += 1) {
    const detected = catalogColumns(matrix[index] ?? []);
    if (detected) {
      headerIndex = index;
      columns = detected;
      break;
    }
  }
  const cols = columns ?? { code: 0, name: 1, unit: 2 };
  const start = headerIndex >= 0 ? headerIndex + 1 : 0;
  const items = new Map<string, CatalogItem>();
  for (let index = start; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const code = cell(row, cols.code);
    const name = cell(row, cols.name);
    if (!code || !name) continue;
    if (headerIndex < 0 && index === 0 && /код|назван/i.test(`${code} ${name}`)) continue;
    items.set(code, { code, name, unit: cell(row, cols.unit) });
  }
  if (items.size === 0) {
    throw new Error("В файле каталога не найдены товары. Нужны колонки: Код, Название, Единица.");
  }
  return [...items.values()];
}

export function priceSample(matrix: string[][], headerRow: number, priceCol: number): { ok: number; total: number } {
  if (priceCol < 0) return { ok: 0, total: 0 };
  let ok = 0;
  let total = 0;
  for (const row of matrix.slice(headerRow, headerRow + 8)) {
    if (!row.some((value) => value.trim())) continue;
    total += 1;
    if (parsePrice(row[priceCol] ?? "") !== null) ok += 1;
  }
  return { ok, total };
}
