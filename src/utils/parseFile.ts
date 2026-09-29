import { unzipSync } from "fflate";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export const TABLE_ACCEPT = ".xlsx,.xls,.csv,.ods,.html,.htm,.txt";
export const PRICE_ACCEPT = `${TABLE_ACCEPT},.pdf,.zip`;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function parsePrice(raw: string): number | null {
  let source = raw.trim().toLowerCase();
  if (!source) return null;
  source = source.replace(/руб\.?|₽|eur|usd|€|\$/g, "").replace(/\s|\u00a0/g, "");
  if (!source) return null;

  const hasComma = source.includes(",");
  const hasDot = source.includes(".");
  if (hasComma && hasDot) {
    if (source.lastIndexOf(",") > source.lastIndexOf(".")) {
      source = source.replace(/\./g, "").replace(",", ".");
    } else {
      source = source.replace(/,/g, "");
    }
  } else if (hasComma) {
    source = source.replace(",", ".");
  }

  if (!/^-?\d+(\.\d+)?$/.test(source)) {
    const matched = source.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    source = matched[0];
  }

  const value = Number(source);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const bytes = new Uint8Array(buffer);
  const hasHighByte = bytes.some((byte) => byte >= 0x80);
  const hasCyrillic = /[А-Яа-яЁё]/.test(utf8);
  if (utf8.includes("\uFFFD") || (hasHighByte && !hasCyrillic)) {
    return new TextDecoder("windows-1251").decode(buffer);
  }
  return utf8;
}

function parseCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  if (result.errors.length && result.data.length === 0) {
    throw new Error("Не удалось разобрать CSV");
  }
  return result.data.map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "").trim()));
}

function parseHtml(text: string): string[][] {
  const document = new DOMParser().parseFromString(text, "text/html");
  const table = document.querySelector("table");
  if (!table) throw new Error("В HTML не найдена таблица");
  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
}

export interface WorkbookSheet {
  name: string;
  matrix: string[][];
}

function cleanMatrix(rows: string[][]): string[][] {
  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

function matrixFromSheet(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  return cleanMatrix(rows.map((row) => (row ?? []).map((cell) => String(cell ?? "").trim())));
}

function parseWorkbook(buffer: ArrayBuffer): WorkbookSheet[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  if (workbook.SheetNames.length === 0) throw new Error("В книге нет листов");
  return workbook.SheetNames.map((name) => ({
    name,
    matrix: matrixFromSheet(workbook.Sheets[name]),
  })).filter((sheet) => sheet.matrix.length > 0);
}

export interface LoadedPriceFile {
  fileName: string;
  sheets: WorkbookSheet[];
  unreadable: string | null;
}

const SCAN_NOTE =
  "PDF не содержит текстовой таблицы. Это скан или изображение: нужно отдельное распознавание. Товарные строки не созданы.";

function spreadsheetName(name: string): boolean {
  return [".xlsx", ".xls", ".ods"].some((extension) => name.toLowerCase().endsWith(extension));
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function sheetsFromBuffer(name: string, buffer: ArrayBuffer): WorkbookSheet[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return [{ name, matrix: cleanMatrix(parseCsv(decodeText(buffer))) }];
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return [{ name, matrix: cleanMatrix(parseHtml(decodeText(buffer))) }];
  }
  const head = new TextDecoder("utf-8").decode(buffer.slice(0, 300)).trim().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<table")) {
    return [{ name, matrix: cleanMatrix(parseHtml(decodeText(buffer))) }];
  }
  return parseWorkbook(buffer);
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function expandNamed(name: string, buffer: ArrayBuffer, depth: number): Promise<LoadedPriceFile[]> {
  if (depth > 3) return [];
  const lower = name.toLowerCase();
  const bytes = new Uint8Array(buffer);
  if (lower.endsWith(".pdf") || isPdf(bytes)) {
    const { extractPdfMatrix } = await import("./pdfTables");
    const extracted = await extractPdfMatrix(buffer);
    if (!extracted.textual) return [{ fileName: name, sheets: [], unreadable: SCAN_NOTE }];
    return [{ fileName: name, sheets: [{ name, matrix: extracted.matrix }], unreadable: null }];
  }
  const archive = lower.endsWith(".zip") || (isZip(bytes) && !spreadsheetName(lower));
  if (archive && !spreadsheetName(lower)) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      return [{ fileName: name, sheets: [], unreadable: "Архив не удалось открыть." }];
    }
    const paths = Object.keys(entries).map((path) => path.replace(/\\/g, "/"));
    const workbookPackage = paths.some((path) => path.endsWith("xl/workbook.xml") || path === "[Content_Types].xml");
    if (workbookPackage) {
      try {
        const sheets = sheetsFromBuffer(name, buffer).filter((sheet) => sheet.matrix.length > 0);
        if (sheets.length > 0) return [{ fileName: name, sheets, unreadable: null }];
      } catch {
        return [{ fileName: name, sheets: [], unreadable: "Книгу Excel не удалось прочитать." }];
      }
    }
    const nested: LoadedPriceFile[] = [];
    for (const [path, content] of Object.entries(entries)) {
      const base = path.split("/").pop() ?? path;
      if (!base || path.endsWith("/") || path.includes("__MACOSX") || base.startsWith(".")) continue;
      nested.push(...(await expandNamed(base, copyBytes(content), depth + 1)));
    }
    if (nested.length === 0) return [{ fileName: name, sheets: [], unreadable: "В архиве нет файлов прайса." }];
    return nested;
  }
  try {
    const sheets = sheetsFromBuffer(name, buffer).filter((sheet) => sheet.matrix.length > 0);
    if (sheets.length === 0) return [{ fileName: name, sheets: [], unreadable: "В файле не найдена таблица." }];
    return [{ fileName: name, sheets, unreadable: null }];
  } catch (reason) {
    return [{ fileName: name, sheets: [], unreadable: reason instanceof Error ? reason.message : "Файл не удалось прочитать." }];
  }
}

export async function loadPriceFiles(file: File): Promise<LoadedPriceFile[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Файл больше 15 МБ. Разбейте прайс на части.");
  }
  return expandNamed(file.name, await file.arrayBuffer(), 0);
}

export async function readSheets(file: File): Promise<WorkbookSheet[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Файл больше 15 МБ. Разбейте прайс на части.");
  }
  const sheets = sheetsFromBuffer(file.name, await file.arrayBuffer());
  if (sheets.length === 0 || sheets.every((sheet) => sheet.matrix.length === 0)) {
    throw new Error("Файл пустой или его формат не распознан");
  }
  return sheets;
}

export async function readMatrix(file: File): Promise<string[][]> {
  const sheets = await readSheets(file);
  return sheets[0].matrix;
}
