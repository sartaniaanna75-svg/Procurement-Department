import Papa from "papaparse";
import * as XLSX from "xlsx";

export const TABLE_ACCEPT = ".xlsx,.xls,.csv,.ods,.html,.htm,.txt";

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

function parseWorkbook(buffer: ArrayBuffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В книге нет листов");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  return rows.map((row) => (row ?? []).map((cell) => String(cell ?? "").trim()));
}

export async function readMatrix(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Файл больше 15 МБ. Разбейте прайс на части.");
  }
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  let matrix: string[][];
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    matrix = parseCsv(decodeText(buffer));
  } else if (name.endsWith(".html") || name.endsWith(".htm")) {
    matrix = parseHtml(decodeText(buffer));
  } else {
    const head = new TextDecoder("utf-8").decode(buffer.slice(0, 300)).trim().toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<table")) {
      matrix = parseHtml(decodeText(buffer));
    } else {
      matrix = parseWorkbook(buffer);
    }
  }
  const cleaned = matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (cleaned.length === 0) throw new Error("Файл пустой или его формат не распознан");
  return cleaned;
}
