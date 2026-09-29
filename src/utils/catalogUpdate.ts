import type { CatalogItem } from "../types";
import { normalizeText } from "./text";

export const CATALOG_FILE_REJECTED = "Файл не похож на выгрузку нашей номенклатуры из 1С. Проверьте выбранный файл.";

export type ShrinkRisk = "none" | "warn" | "severe";

export interface CatalogPreview {
  items: CatalogItem[];
  headerRow: number;
  nameHeader: string;
  barcodeHeader: string;
  codeHeader: string;
  dataRows: number;
  skipped: number;
  found: number;
  withBarcode: number;
  withoutBarcode: number;
  added: number;
  changed: number;
  removed: number;
  shrink: ShrinkRisk;
}

export type CatalogInspection = { ok: true; preview: CatalogPreview } | { ok: false; reason: string };

interface CatalogColumns {
  code: number;
  name: number;
  unit: number;
  barcode: number;
  codeIsBarcode: boolean;
}

function columnHeader(headers: string[], index: number): string {
  if (index < 0) return "";
  return (headers[index] ?? "").trim();
}

function detectColumns(headers: string[]): CatalogColumns | null {
  const found: Partial<Record<"code" | "name" | "unit" | "barcode", number>> = {};
  headers.forEach((header, index) => {
    const value = normalizeText(header);
    if (!value) return;
    if (found.barcode === undefined && /штрих|barcode|ean|gtin|баркод/.test(value)) found.barcode = index;
    else if (found.code === undefined && /артикул|код|code|sku/.test(value) && !/постав/.test(value) && !/штрих|barcode|ean|gtin|баркод/.test(value)) found.code = index;
    else if (found.name === undefined && /наимен|назван|номенклат|товар|name/.test(value)) found.name = index;
    else if (found.unit === undefined && /единиц|ед\.?\s*изм|^ед\.?$|unit/.test(value)) found.unit = index;
  });
  if (found.name === undefined || found.barcode === undefined) return null;
  return {
    code: found.code ?? found.barcode,
    name: found.name,
    unit: found.unit ?? -1,
    barcode: found.barcode,
    codeIsBarcode: found.code === undefined,
  };
}

function findHeader(matrix: string[][]): { headerIndex: number; columns: CatalogColumns } | null {
  const limit = Math.min(matrix.length, 30);
  let best: { headerIndex: number; columns: CatalogColumns } | null = null;
  let bestScore = 0;
  for (let index = 0; index < limit; index += 1) {
    const columns = detectColumns(matrix[index] ?? []);
    if (!columns) continue;
    let score = 4;
    if (!columns.codeIsBarcode) score += 2;
    if (columns.unit >= 0) score += 1;
    if (score > bestScore) {
      best = { headerIndex: index, columns };
      bestScore = score;
    }
  }
  return best;
}

/** Штрихкод как строка цифр. Пустая ячейка остаётся пустой и не превращается в число. */
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

export function readCatalogItems(matrix: string[][]): { ok: true; items: CatalogItem[]; headerRow: number; nameHeader: string; barcodeHeader: string; codeHeader: string; dataRows: number; skipped: number } | { ok: false; reason: string } {
  const header = findHeader(matrix);
  if (!header) return { ok: false, reason: CATALOG_FILE_REJECTED };
  const headers = matrix[header.headerIndex] ?? [];
  const columns = header.columns;
  const items = new Map<string, CatalogItem>();
  let dataRows = 0;
  let skipped = 0;
  for (let index = header.headerIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    if (!row.some((value) => value.trim())) continue;
    dataRows += 1;
    const name = cell(row, columns.name);
    const barcode = barcodeFromCell(cell(row, columns.barcode));
    const ownCode = columns.codeIsBarcode ? barcode : cell(row, columns.code);
    const code = ownCode || barcode;
    if (!name || !code) {
      skipped += 1;
      continue;
    }
    items.set(code, { code, name, unit: cell(row, columns.unit), barcode });
  }
  if (items.size === 0) return { ok: false, reason: CATALOG_FILE_REJECTED };
  return {
    ok: true,
    items: [...items.values()],
    headerRow: header.headerIndex + 1,
    nameHeader: columnHeader(headers, columns.name),
    barcodeHeader: columnHeader(headers, columns.barcode),
    codeHeader: columns.codeIsBarcode ? "" : columnHeader(headers, columns.code),
    dataRows,
    skipped,
  };
}

export function inspectCatalog(matrix: string[][], current: CatalogItem[]): CatalogInspection {
  const read = readCatalogItems(matrix);
  if (!read.ok) return read;
  const byCode = new Map(current.map((item) => [item.code, item]));
  const byBarcode = barcodeIndex(current);
  const matched = new Set<string>();
  let added = 0;
  let changed = 0;
  for (const item of read.items) {
    const previous = matchCurrent(item, byCode, byBarcode);
    if (!previous) {
      added += 1;
      continue;
    }
    matched.add(previous.code);
    if (!sameItem(previous, { ...item, code: previous.code })) changed += 1;
  }
  const withBarcode = read.items.filter((item) => item.barcode).length;
  return {
    ok: true,
    preview: {
      items: read.items,
      headerRow: read.headerRow,
      nameHeader: read.nameHeader,
      barcodeHeader: read.barcodeHeader,
      codeHeader: read.codeHeader,
      dataRows: read.dataRows,
      skipped: read.skipped,
      found: read.items.length,
      withBarcode,
      withoutBarcode: read.items.length - withBarcode,
      added,
      changed,
      removed: current.filter((item) => !matched.has(item.code)).length,
      shrink: shrinkRisk(current.length, read.items.length),
    },
  };
}

/** Сохраняет прежний код, если товар узнаётся по коду или единственному штрихкоду. */
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
