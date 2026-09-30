import { barcodeFromCell } from "../catalogUpdate";
import { normalizeText } from "../text";
import type {
  DemandControlRow,
  DemandIdentity,
  DemandSourceKind,
  DemandSourceMeta,
  DemandStockRow,
  DemandTurnoverRow,
} from "./types";

export function parseDemandNumber(raw: string): number | null {
  let source = raw.trim().toLowerCase().replace(/\s|\u00a0/g, "").replace("%", "");
  if (!source || source === "-" || source === "—" || source === "х" || source === "x") return null;
  source = source.replace(/руб\.?|₽/g, "");
  const hasComma = source.includes(",");
  const hasDot = source.includes(".");
  if (hasComma && hasDot) {
    // 1.234,56 или 1,234.56
    if (source.lastIndexOf(",") > source.lastIndexOf(".")) {
      source = source.replace(/\./g, "").replace(",", ".");
    } else {
      source = source.replace(/,/g, "");
    }
  } else if (hasComma) {
    // В отчётах 1С запятая — десятичный разделитель: 11,565
    const parts = source.split(",");
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      source = `${parts[0]}.${parts[1]}`;
    } else {
      source = source.replace(/,/g, "");
    }
  }
  if (!/^-?\d+(\.\d+)?$/.test(source)) {
    const matched = source.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    source = matched[0];
  }
  const value = Number(source);
  return Number.isFinite(value) ? value : null;
}

type FieldKey =
  | "name"
  | "code"
  | "barcode"
  | "onHand"
  | "shipping"
  | "reserved"
  | "available"
  | "expected"
  | "toSupply"
  | "deficit"
  | "surplus"
  | "endBalance"
  | "avgBalance"
  | "consumption"
  | "avgDaily"
  | "stockDays"
  | "turnoverPeriod";

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  name: ["номенклатура", "наименование", "товар", "название"],
  code: ["код", "код номенклатуры", "артикул", "id", "guid"],
  barcode: ["штрихкод", "штрих-код", "ean", "barcode"],
  onHand: ["в наличии", "наличие", "остаток в наличии"],
  shipping: ["отгружается", "в отгрузке"],
  reserved: ["в резерве", "резерв"],
  available: ["доступно", "доступный остаток", "свободно"],
  expected: ["ожидается", "ожидаемое поступление", "ожидаемые поступления"],
  toSupply: ["к обеспечению", "обеспечение"],
  deficit: ["дефицит"],
  surplus: ["излишек", "излишки"],
  endBalance: ["остаток на конец периода", "конечный остаток", "остаток конец"],
  avgBalance: ["средний остаток", "среднемесячный остаток"],
  consumption: ["потребление", "потребление за период", "расход", "расход за период"],
  avgDaily: ["среднедневное потребление", "среднедневное", "среднее дневное потребление", "ср.дневное потребление"],
  stockDays: ["уровень запасов в днях", "запас в днях", "запас, дней", "дней запаса", "уровень запасов"],
  turnoverPeriod: ["период оборачиваемости", "оборачиваемость", "оборачиваемость, дн", "дней оборачиваемости"],
};

function headerKey(cell: string): string {
  return normalizeText(cell).replace(/['"`]/g, "").replace(/\s+/g, " ").trim();
}

function matchField(header: string): FieldKey | null {
  const key = headerKey(header);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[FieldKey, string[]]>) {
    for (const alias of aliases) {
      if (key === alias || key.startsWith(`${alias} `) || key.startsWith(`${alias},`) || key.startsWith(`${alias}(`)) {
        return field;
      }
    }
  }
  // Частые укороченные формы 1С
  if (key === "дн" || key === "дней") return "stockDays";
  return null;
}

interface MappedHeader {
  rowIndex: number;
  map: Partial<Record<FieldKey, number>>;
  matched: string[];
  unrecognized: string[];
}

function scoreMap(map: Partial<Record<FieldKey, number>>): number {
  let score = 0;
  if (map.name !== undefined) score += 5;
  if (map.code !== undefined) score += 3;
  if (map.barcode !== undefined) score += 2;
  if (map.available !== undefined || map.onHand !== undefined) score += 3;
  if (map.avgDaily !== undefined || map.consumption !== undefined) score += 4;
  if (map.endBalance !== undefined || map.stockDays !== undefined) score += 2;
  return score;
}

function findHeader(matrix: string[][]): MappedHeader | null {
  let best: MappedHeader | null = null;
  const limit = Math.min(matrix.length, 40);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const map: Partial<Record<FieldKey, number>> = {};
    const matched: string[] = [];
    const unrecognized: string[] = [];
    row.forEach((cell, columnIndex) => {
      const text = cell.trim();
      if (!text) return;
      const field = matchField(text);
      if (!field) {
        if (text.length >= 2 && !/^\d+([.,]\d+)?$/.test(text)) unrecognized.push(text);
        return;
      }
      if (map[field] === undefined) {
        map[field] = columnIndex;
        matched.push(`${text}→${field}`);
      }
    });
    const score = scoreMap(map);
    if (score < 5 || map.name === undefined) continue;
    if (!best || score > scoreMap(best.map)) {
      best = { rowIndex, map, matched, unrecognized };
    }
  }
  return best;
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined || index < 0) return "";
  return (row[index] ?? "").trim();
}

function identityFrom(row: string[], map: Partial<Record<FieldKey, number>>): DemandIdentity {
  const name = cell(row, map.name);
  const code = cell(row, map.code);
  const barcode = barcodeFromCell(cell(row, map.barcode));
  return { name, code, barcode };
}

function rowId(kind: string, identity: DemandIdentity, index: number): string {
  const key = [identity.code, identity.barcode, normalizeText(identity.name)].filter(Boolean).join("|") || String(index);
  return `${kind}:${key}:${index}`;
}

function extractPeriodLabel(matrix: string[][]): string {
  const sample = matrix.slice(0, 12).flat().join(" ");
  const range =
    sample.match(/(\d{1,2}[./]\d{1,2}[./]\d{2,4})\s*[–—\-]\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})/) ??
    sample.match(/период[:\s]+([^\n;]+)/i);
  if (!range) return "";
  if (range[2]) return `${range[1]}–${range[2]}`;
  return range[1].trim();
}

function isTotalRow(name: string): boolean {
  const key = normalizeText(name);
  return !key || key === "итого" || key.startsWith("итого ") || key === "всего" || key.startsWith("всего ");
}

export interface ParsedStockReport {
  meta: DemandSourceMeta;
  rows: DemandStockRow[];
}

export interface ParsedTurnoverReport {
  meta: DemandSourceMeta;
  rows: DemandTurnoverRow[];
}

export interface ParsedControlReport {
  meta: DemandSourceMeta;
  rows: DemandControlRow[];
}

function baseMeta(kind: DemandSourceKind, fileName: string, header: MappedHeader, rowCount: number, periodLabel: string): DemandSourceMeta {
  return {
    kind,
    fileName,
    loadedAt: new Date().toISOString(),
    periodLabel,
    rowCount,
    matchedHeaders: header.matched,
    unrecognizedHeaders: header.unrecognized.slice(0, 40),
  };
}

export function parseStockReport(matrix: string[][], fileName: string): ParsedStockReport {
  const header = findHeader(matrix);
  if (!header) throw new Error("Не найдены заголовки отчёта «Остатки и доступность» (нужны колонки номенклатуры и остатков).");
  const rows: DemandStockRow[] = [];
  for (let index = header.rowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const identity = identityFrom(row, header.map);
    if (isTotalRow(identity.name) && !identity.code && !identity.barcode) continue;
    if (!identity.name && !identity.code && !identity.barcode) continue;
    rows.push({
      id: rowId("stock", identity, index),
      identity,
      onHand: parseDemandNumber(cell(row, header.map.onHand)),
      shipping: parseDemandNumber(cell(row, header.map.shipping)),
      reserved: parseDemandNumber(cell(row, header.map.reserved)),
      available: parseDemandNumber(cell(row, header.map.available)),
      expected: parseDemandNumber(cell(row, header.map.expected)),
      toSupply: parseDemandNumber(cell(row, header.map.toSupply)),
      deficit: parseDemandNumber(cell(row, header.map.deficit)),
      surplus: parseDemandNumber(cell(row, header.map.surplus)),
    });
  }
  if (rows.length === 0) throw new Error("В отчёте остатков нет товарных строк.");
  return { meta: baseMeta("stock", fileName, header, rows.length, ""), rows };
}

export function parseTurnoverReport(matrix: string[][], fileName: string): ParsedTurnoverReport {
  const header = findHeader(matrix);
  if (!header) throw new Error("Не найдены заголовки отчёта «Оборачиваемость запасов».");
  if (header.map.avgDaily === undefined && header.map.consumption === undefined) {
    throw new Error("В оборачиваемости нет колонок «Среднедневное потребление» или «Потребление».");
  }
  const rows: DemandTurnoverRow[] = [];
  for (let index = header.rowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const identity = identityFrom(row, header.map);
    if (isTotalRow(identity.name) && !identity.code && !identity.barcode) continue;
    if (!identity.name && !identity.code && !identity.barcode) continue;
    rows.push({
      id: rowId("turn", identity, index),
      identity,
      endBalance: parseDemandNumber(cell(row, header.map.endBalance)),
      avgBalance: parseDemandNumber(cell(row, header.map.avgBalance)),
      consumption: parseDemandNumber(cell(row, header.map.consumption)),
      avgDaily: parseDemandNumber(cell(row, header.map.avgDaily)),
      stockDays: parseDemandNumber(cell(row, header.map.stockDays)),
      turnoverPeriod: parseDemandNumber(cell(row, header.map.turnoverPeriod)),
    });
  }
  if (rows.length === 0) throw new Error("В отчёте оборачиваемости нет товарных строк.");
  return {
    meta: baseMeta("turnover", fileName, header, rows.length, extractPeriodLabel(matrix)),
    rows,
  };
}

export function parseControlReport(
  matrix: string[][],
  fileName: string,
  kind: "calendar" | "costOrg1" | "costOrg2",
): ParsedControlReport {
  const header = findHeader(matrix);
  if (!header) throw new Error("Не удалось распознать заголовки контрольного отчёта.");
  const rows: DemandControlRow[] = [];
  for (let index = header.rowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const identity = identityFrom(row, header.map);
    if (!identity.name && !identity.code && !identity.barcode) continue;
    if (isTotalRow(identity.name)) continue;
    const values: Record<string, number | null> = {};
    for (const [field, column] of Object.entries(header.map)) {
      if (field === "name" || field === "code" || field === "barcode" || column === undefined) continue;
      values[field] = parseDemandNumber(cell(row, column));
    }
    rows.push({
      id: rowId(kind, identity, index),
      identity,
      source: kind,
      note: kind === "calendar" ? "Товарный календарь (контроль)" : "Себестоимость по операциям (контроль Intercompany)",
      values,
    });
  }
  return {
    meta: baseMeta(kind, fileName, header, rows.length, extractPeriodLabel(matrix)),
    rows,
  };
}

/** Лучший лист книги для отчёта: больше совпадений заголовков. */
export function pickBestSheet(sheets: Array<{ name: string; matrix: string[][] }>): { name: string; matrix: string[][] } {
  let best = sheets[0];
  let bestScore = -1;
  for (const sheet of sheets) {
    const header = findHeader(sheet.matrix);
    const score = header ? scoreMap(header.map) : -1;
    if (score > bestScore) {
      best = sheet;
      bestScore = score;
    }
  }
  if (!best) throw new Error("В файле нет листов.");
  return best;
}
