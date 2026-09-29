import type { AppState, CatalogImportMeta, CatalogItem, CatalogUpdateSummary, ColumnDetectionMode, MatchDecision } from "../types";
import { listRows } from "./rows";
import { normalizeText } from "./text";

export const CATALOG_FILE_REJECTED = "Файл не похож на выгрузку нашей номенклатуры из 1С. Проверьте выбранный файл.";

export type ShrinkRisk = "none" | "warn" | "severe";

export interface CatalogPreview {
  fileName: string;
  items: CatalogItem[];
  meta: CatalogImportMeta;
  nameHeader: string;
  barcodeHeader: string;
  codeHeader: string;
  articleHeader: string;
  rowsInFile: number;
  emptyRows: number;
  dataRows: number;
  skipped: number;
  found: number;
  withBarcode: number;
  withoutBarcode: number;
  uniqueBarcodes: number;
  duplicateBarcodes: number;
  added: number;
  changed: number;
  unchanged: number;
  removed: number;
  shrink: ShrinkRisk;
  warnings: string[];
  suspicious: boolean;
  substantialChange: boolean;
}

export type CatalogInspection = { ok: true; preview: CatalogPreview } | { ok: false; reason: string };
export type { CatalogImportMeta, CatalogUpdateSummary };

interface CatalogColumns {
  code: number;
  name: number;
  unit: number;
  barcode: number;
  article: number;
  codeIsGenerated: boolean;
}

function columnLabel(headers: string[], index: number, fallback: string): string {
  if (index < 0) return "";
  const header = (headers[index] ?? "").trim();
  return header || fallback;
}

function detectColumnsFromHeaders(headers: string[]): CatalogColumns | null {
  const found: Partial<Record<"code" | "name" | "unit" | "barcode" | "article", number>> = {};
  headers.forEach((header, index) => {
    const value = normalizeText(header);
    if (!value) return;
    if (found.barcode === undefined && /штрих[\s-]?код|barcode|ean|gtin|баркод/.test(value)) found.barcode = index;
    else if (found.article === undefined && /артикул/.test(value) && !/штрих|barcode/.test(value)) found.article = index;
    else if (found.code === undefined && /^(код|code|sku)$|код номенклат|номенклатур.*код/.test(value) && !/постав|штрих|barcode|артикул/.test(value)) found.code = index;
    else if (found.name === undefined && /наимен|назван|номенклат|(^|\s)товар|(^|\s)name|наименование номенклат/.test(value)) found.name = index;
    else if (found.unit === undefined && /единиц|ед\.?\s*изм|^ед\.?$|unit/.test(value)) found.unit = index;
  });
  if (found.name === undefined) return null;
  const code = found.code ?? -1;
  return {
    code,
    name: found.name,
    unit: found.unit ?? -1,
    barcode: found.barcode ?? -1,
    article: found.article ?? -1,
    codeIsGenerated: code < 0,
  };
}

function looksLikeBarcode(value: string): boolean {
  return barcodeFromCell(value) !== "";
}

function looksLikeName(value: string): boolean {
  const text = value.trim();
  if (text.length < 2) return false;
  if (/^\d+([.,]\d+)?$/.test(text.replace(/\s/g, ""))) return false;
  return /\p{L}/u.test(text);
}

function columnBarcodeRatio(matrix: string[][], col: number, from: number, to: number): number {
  let total = 0;
  let hits = 0;
  for (let row = from; row < to; row += 1) {
    const value = (matrix[row]?.[col] ?? "").trim();
    if (!value) continue;
    total += 1;
    if (looksLikeBarcode(value)) hits += 1;
  }
  return total === 0 ? 0 : hits / total;
}

function columnNameRatio(matrix: string[][], col: number, from: number, to: number): number {
  let total = 0;
  let hits = 0;
  for (let row = from; row < to; row += 1) {
    const value = (matrix[row]?.[col] ?? "").trim();
    if (!value) continue;
    total += 1;
    if (looksLikeName(value)) hits += 1;
  }
  return total === 0 ? 0 : hits / total;
}

function detectColumnsFromContent(matrix: string[][]): { columns: CatalogColumns; startRow: number } | null {
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  if (width < 1) return null;
  const sampleEnd = Math.min(matrix.length, 80);
  let startRow = 0;
  if (matrix.length > 0 && detectColumnsFromHeaders(matrix[0] ?? [])) startRow = 1;
  let bestName = -1;
  let bestNameScore = 0;
  let bestBarcode = -1;
  let bestBarcodeScore = 0;
  for (let col = 0; col < width; col += 1) {
    const nameScore = columnNameRatio(matrix, col, startRow, sampleEnd);
    const barcodeScore = columnBarcodeRatio(matrix, col, startRow, sampleEnd);
    if (nameScore > bestNameScore) {
      bestNameScore = nameScore;
      bestName = col;
    }
    if (barcodeScore > bestBarcodeScore) {
      bestBarcodeScore = barcodeScore;
      bestBarcode = col;
    }
  }
  if (bestName < 0 || bestNameScore < 0.45) return null;
  if (bestBarcode === bestName && width > 1) {
    for (let col = 0; col < width; col += 1) {
      if (col === bestName) continue;
      const barcodeScore = columnBarcodeRatio(matrix, col, startRow, sampleEnd);
      if (barcodeScore >= 0.35) {
        bestBarcode = col;
        bestBarcodeScore = barcodeScore;
        break;
      }
    }
  }
  return {
    startRow,
    columns: {
      code: -1,
      name: bestName,
      unit: -1,
      barcode: bestBarcodeScore >= 0.25 ? bestBarcode : -1,
      article: -1,
      codeIsGenerated: true,
    },
  };
}

function findLayout(matrix: string[][]): { headerIndex: number; columns: CatalogColumns; mode: ColumnDetectionMode } | null {
  const limit = Math.min(matrix.length, 30);
  let best: { headerIndex: number; columns: CatalogColumns; mode: ColumnDetectionMode; score: number } | null = null;
  for (let index = 0; index < limit; index += 1) {
    const columns = detectColumnsFromHeaders(matrix[index] ?? []);
    if (!columns) continue;
    let score = 5;
    if (!columns.codeIsGenerated) score += 2;
    if (columns.barcode >= 0) score += 2;
    if (columns.unit >= 0) score += 1;
    if (columns.article >= 0) score += 1;
    if (!best || score > best.score) best = { headerIndex: index, columns, mode: "headers", score };
  }
  const content = detectColumnsFromContent(matrix);
  if (content) {
    let score = 3 + (content.columns.name >= 0 ? 2 : 0);
    if (content.columns.barcode >= 0) score += 2;
    if (!best || score > best.score) best = { headerIndex: content.startRow - 1, columns: content.columns, mode: "content", score };
  }
  if (!best) return null;
  return { headerIndex: best.headerIndex, columns: best.columns, mode: best.mode };
}

/** Штрихкод как строка цифр. Пустая ячейка остаётся пустой. */
export function barcodeFromCell(value: string): string {
  let text = value.trim();
  if (!text || text === "-" || text === "—") return "";
  const scientific = /^(\d+)(?:\.(\d+))?e\+(\d+)$/i.exec(text.replace(/\s/g, "").replace(",", "."));
  if (scientific) {
    const fraction = scientific[2] ?? "";
    const exponent = Number(scientific[3]);
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > 18) return "";
    const zeros = exponent - fraction.length;
    if (zeros < 0) return "";
    text = scientific[1] + fraction + "0".repeat(zeros);
  }
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  text = text.replace(/[\s\-–—]/g, "");
  if (!/^\d+$/.test(text)) return "";
  if (text.length === 8 || text.length === 12 || text.length === 13 || text.length === 14) return text;
  return "";
}

function stableCode(name: string, barcode: string, article: string, index: number): string {
  if (article.trim()) return article.trim();
  if (barcode) return barcode;
  const base = normalizeText(name).replace(/\s+/g, " ").slice(0, 120);
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return `~${hash.toString(36)}-${index}`;
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

function sameItem(left: CatalogItem, right: CatalogItem): boolean {
  return left.name === right.name && left.unit === right.unit && (left.barcode ?? "") === (right.barcode ?? "");
}

function barcodeIndex(items: CatalogItem[]): Map<string, CatalogItem[]> {
  const map = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const barcode = item.barcode?.trim() ?? "";
    if (!barcode) continue;
    const list = map.get(barcode) ?? [];
    list.push(item);
    map.set(barcode, list);
  }
  return map;
}

function matchCurrent(item: CatalogItem, byCode: Map<string, CatalogItem>, byBarcode: Map<string, CatalogItem[]>): CatalogItem | null {
  const bySameCode = byCode.get(item.code);
  if (bySameCode) return bySameCode;
  const barcode = item.barcode?.trim() ?? "";
  if (!barcode) return null;
  const found = byBarcode.get(barcode) ?? [];
  return found.length === 1 ? found[0] : null;
}

export function shrinkRisk(currentCount: number, nextCount: number): ShrinkRisk {
  if (currentCount < 10 || nextCount >= currentCount) return "none";
  const ratio = nextCount / currentCount;
  if (ratio < 0.2 || (currentCount >= 1000 && nextCount < 100)) return "severe";
  if (ratio < 0.5) return "warn";
  return "none";
}

function countBarcodeStats(items: CatalogItem[]): { unique: number; duplicates: number } {
  const map = barcodeIndex(items);
  let duplicates = 0;
  for (const list of map.values()) if (list.length > 1) duplicates += list.length - 1;
  return { unique: map.size, duplicates };
}

function looksLikeAccountingDump(matrix: string[][], columns: CatalogColumns, startRow: number): boolean {
  let rows = 0;
  let hits = 0;
  for (let index = startRow; index < matrix.length; index += 1) {
    const name = cell(matrix[index] ?? [], columns.name);
    if (!name) continue;
    rows += 1;
    if (/(^|\s)(итого|касса|сальдо|оборот)(\s|$)/i.test(name) || /р\s*\/\s*сч|рсч/i.test(name)) hits += 1;
  }
  return rows > 0 && hits / rows >= 0.5;
}

export function readCatalogItems(matrix: string[][]): {
  ok: true;
  items: CatalogItem[];
  meta: CatalogImportMeta;
  nameHeader: string;
  barcodeHeader: string;
  codeHeader: string;
  articleHeader: string;
  rowsInFile: number;
  emptyRows: number;
  dataRows: number;
  skipped: number;
} | { ok: false; reason: string } {
  const layout = findLayout(matrix);
  if (!layout) return { ok: false, reason: CATALOG_FILE_REJECTED };
  const headers = layout.headerIndex >= 0 ? matrix[layout.headerIndex] ?? [] : [];
  const columns = layout.columns;
  const start = layout.mode === "headers" ? layout.headerIndex + 1 : layout.headerIndex + 1;
  if (looksLikeAccountingDump(matrix, columns, start)) return { ok: false, reason: CATALOG_FILE_REJECTED };
  const items = new Map<string, CatalogItem>();
  let rowsInFile = matrix.length;
  let emptyRows = 0;
  let dataRows = 0;
  let skipped = 0;
  let rowIndex = 0;
  for (let index = start; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    if (!row.some((value) => value.trim())) {
      emptyRows += 1;
      continue;
    }
    dataRows += 1;
    const name = cell(row, columns.name);
    const barcode = columns.barcode >= 0 ? barcodeFromCell(cell(row, columns.barcode)) : "";
    const article = cell(row, columns.article);
    const explicitCode = columns.codeIsGenerated ? "" : cell(row, columns.code);
    const code = explicitCode || (barcode && !columns.codeIsGenerated ? barcode : "") || stableCode(name, barcode, article, rowIndex);
    rowIndex += 1;
    if (!name) {
      skipped += 1;
      continue;
    }
    items.set(code, { code, name, unit: cell(row, columns.unit), barcode });
  }
  if (items.size === 0) return { ok: false, reason: CATALOG_FILE_REJECTED };
  const colLabel = (idx: number) => columnLabel(headers, idx, `колонка ${idx + 1}`);
  return {
    ok: true,
    items: [...items.values()],
    meta: {
      mode: layout.mode,
      headerRow: layout.headerIndex >= 0 ? layout.headerIndex + 1 : 0,
      nameCol: columns.name,
      barcodeCol: columns.barcode,
      codeCol: columns.code,
      articleCol: columns.article,
      unitCol: columns.unit,
    },
    nameHeader: colLabel(columns.name),
    barcodeHeader: columns.barcode >= 0 ? colLabel(columns.barcode) : "—",
    codeHeader: columns.codeIsGenerated ? "" : colLabel(columns.code),
    articleHeader: columns.article >= 0 ? colLabel(columns.article) : "",
    rowsInFile,
    emptyRows,
    dataRows,
    skipped,
  };
}

function buildWarnings(preview: Omit<CatalogPreview, "warnings" | "suspicious" | "substantialChange">, current: CatalogItem[], previousMeta?: CatalogImportMeta | null): string[] {
  const warnings: string[] = [];
  if (preview.shrink !== "none") {
    warnings.push(`В новом файле ${preview.found} ${preview.found === 1 ? "товар" : preview.found < 5 ? "товара" : "товаров"} при текущих ${current.length}.`);
  }
  if (preview.dataRows > 0 && preview.skipped / preview.dataRows > 0.35) {
    warnings.push("Большая часть строк файла не распознана как товары.");
  }
  if (preview.found < 5 && current.length >= 20) warnings.push("Файл содержит слишком мало товарных строк.");
  if (preview.duplicateBarcodes > 0) warnings.push(`В файле есть повторяющиеся штрихкоды: ${preview.duplicateBarcodes}.`);
  if (previousMeta && previousMeta.mode !== preview.meta.mode) {
    warnings.push("Структура файла отличается от прошлой успешной загрузки.");
  } else if (previousMeta && previousMeta.nameCol !== preview.meta.nameCol) {
    warnings.push("Колонка названия определена иначе, чем в прошлый раз.");
  }
  return warnings;
}

export function inspectCatalog(matrix: string[][], current: CatalogItem[], fileName = "", previousMeta?: CatalogImportMeta | null): CatalogInspection {
  const read = readCatalogItems(matrix);
  if (!read.ok) return read;
  const byCode = new Map(current.map((item) => [item.code, item]));
  const byBarcode = barcodeIndex(current);
  const matched = new Set<string>();
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const item of read.items) {
    const previous = matchCurrent(item, byCode, byBarcode);
    if (!previous) {
      added += 1;
      continue;
    }
    matched.add(previous.code);
    if (sameItem(previous, { ...item, code: previous.code })) unchanged += 1;
    else changed += 1;
  }
  const withBarcode = read.items.filter((item) => item.barcode).length;
  const barcodeStats = countBarcodeStats(read.items);
  const shrink = shrinkRisk(current.length, read.items.length);
  const base = {
    fileName,
    items: read.items,
    meta: read.meta,
    nameHeader: read.nameHeader,
    barcodeHeader: read.barcodeHeader,
    codeHeader: read.codeHeader,
    articleHeader: read.articleHeader,
    rowsInFile: read.rowsInFile,
    emptyRows: read.emptyRows,
    dataRows: read.dataRows,
    skipped: read.skipped,
    found: read.items.length,
    withBarcode,
    withoutBarcode: read.items.length - withBarcode,
    uniqueBarcodes: barcodeStats.unique,
    duplicateBarcodes: barcodeStats.duplicates,
    added,
    changed,
    unchanged,
    removed: current.filter((item) => !matched.has(item.code)).length,
    shrink,
  };
  const warnings = buildWarnings(base, current, previousMeta);
  const substantialChange = shrink !== "none" || added + changed + base.removed >= Math.max(20, Math.round(current.length * 0.05));
  return {
    ok: true,
    preview: {
      ...base,
      warnings,
      suspicious: shrink !== "none" || warnings.length > 0,
      substantialChange,
    },
  };
}

/** Сохраняет прежний код по коду 1С или единственному штрихкоду. */
export function alignCatalog(current: CatalogItem[], incoming: CatalogItem[]): CatalogItem[] {
  const byCode = new Map(current.map((item) => [item.code, item]));
  const byBarcode = barcodeIndex(current);
  const used = new Set<string>();
  return incoming.map((item) => {
    const sameCode = byCode.get(item.code);
    if (sameCode && !used.has(sameCode.code)) {
      used.add(sameCode.code);
      return item;
    }
    const barcode = item.barcode?.trim() ?? "";
    const found = barcode ? (byBarcode.get(barcode) ?? []).filter((old) => !used.has(old.code)) : [];
    if (found.length === 1) {
      used.add(found[0].code);
      return { ...item, code: found[0].code };
    }
    return item;
  });
}

/** Новая выгрузка + позиции, которых нет в файле, но они были в рабочем каталоге. */
export function mergeCatalog(current: CatalogItem[], incoming: CatalogItem[]): CatalogItem[] {
  const aligned = alignCatalog(current, incoming);
  const newBarcodes = new Set(aligned.map((item) => item.barcode).filter(Boolean));
  const newCodes = new Set(aligned.map((item) => item.code));
  const legacy = current.filter((item) => {
    if (newCodes.has(item.code)) return false;
    if (item.barcode && newBarcodes.has(item.barcode)) return false;
    return true;
  });
  return [...aligned, ...legacy];
}

export function reconcileMatchesAfterCatalog(state: AppState): AppState {
  const codes = new Set(state.catalog.map((item) => item.code));
  const byBarcode = barcodeIndex(state.catalog);
  const rowsByKey = new Map(listRows(state.uploads).map((row) => [row.key, row]));
  const matches: Record<string, MatchDecision> = { ...state.matches };
  for (const [key, decision] of Object.entries(matches)) {
    if (!decision.code || codes.has(decision.code)) continue;
    if (decision.status !== "confirmed" && decision.status !== "picked") continue;
    const row = rowsByKey.get(key);
    const digits = row?.barcode ? barcodeFromCell(row.barcode) : "";
    const hits = digits ? byBarcode.get(digits) ?? [] : [];
    if (hits.length === 1) {
      matches[key] = { ...decision, code: hits[0].code, status: "review", reason: "После обновления каталога связь восстановлена по штрихкоду. Проверьте позицию." };
      continue;
    }
    if (hits.length > 1) {
      matches[key] = { ...decision, code: "", status: "review", confidence: 0, reason: "После обновления каталога штрихкод указывает на несколько наших позиций." };
      continue;
    }
    matches[key] = { ...decision, status: "review", reason: "После обновления каталога требуется проверить связь с нашей номенклатурой." };
  }
  return { ...state, matches };
}

export function summarizeUpdate(preview: CatalogPreview, mergedCount: number, needsReview: number): CatalogUpdateSummary {
  return {
    added: preview.added,
    changed: preview.changed,
    unchanged: preview.unchanged,
    removedFromExport: preview.removed,
    needsReview,
    total: mergedCount,
  };
}
