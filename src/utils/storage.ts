import type { AppState, CatalogItem, ColumnMapper, MatchDecision, MatchStatus, PriceTuple, Upload } from "../types";
import { STORAGE_KEY } from "../types";

export function emptyState(): AppState {
  return {
    uploads: [],
    catalog: [],
    mappers: {},
    matches: {},
    confirmed: {},
    absent: {},
    cleared: {},
    seen: {},
    seenReady: false,
  };
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTuple(value: unknown): PriceTuple | null {
  if (!Array.isArray(value) || value.length < 7) return null;
  const price = Number(value[2]);
  if (!Number.isFinite(price)) return null;
  return [
    String(value[0] ?? ""),
    String(value[1] ?? ""),
    price,
    String(value[3] ?? ""),
    String(value[4] ?? ""),
    String(value[5] ?? ""),
    String(value[6] ?? ""),
  ];
}

function normalizeUpload(value: unknown): Upload | null {
  if (!isPlain(value) || !Array.isArray(value.rows)) return null;
  return {
    file: String(value.file ?? ""),
    supplier: String(value.supplier ?? ""),
    uploadedAt: String(value.uploadedAt ?? ""),
    rows: value.rows.map(normalizeTuple).filter((row): row is PriceTuple => row !== null),
  };
}

function normalizeCatalogItem(value: unknown): CatalogItem | null {
  if (!isPlain(value)) return null;
  const code = String(value.code ?? "").trim();
  const name = String(value.name ?? "").trim();
  if (!code || !name) return null;
  return { code, name, unit: String(value.unit ?? "").trim() };
}

function normalizeMapper(value: unknown): ColumnMapper | null {
  if (!isPlain(value)) return null;
  const mapper = {
    headerRow: Number(value.headerRow),
    name: Number(value.name),
    price: Number(value.price),
    barcode: Number(value.barcode),
    code: Number(value.code),
    unit: Number(value.unit),
  };
  if (!Number.isInteger(mapper.headerRow) || mapper.headerRow < 1) return null;
  if (![mapper.name, mapper.price, mapper.barcode, mapper.code, mapper.unit].every(Number.isInteger)) return null;
  return mapper;
}

const STATUSES = new Set<MatchStatus>(["need", "confirmed", "picked", "missing"]);

function normalizeMatch(value: unknown): MatchDecision | null {
  if (!isPlain(value) || typeof value.status !== "string" || !STATUSES.has(value.status as MatchStatus)) return null;
  return {
    status: value.status as MatchStatus,
    code: String(value.code ?? ""),
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0,
    reason: String(value.reason ?? ""),
  };
}

function mapValues<T>(value: unknown, convert: (item: unknown) => T | null): Record<string, T> {
  if (!isPlain(value)) return {};
  const result: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = convert(item);
    if (normalized !== null) result[key] = normalized;
  }
  return result;
}

export function normalizeState(value: unknown): AppState {
  const base = emptyState();
  if (!isPlain(value)) return base;
  return {
    uploads: Array.isArray(value.uploads)
      ? value.uploads.map(normalizeUpload).filter((upload): upload is Upload => upload !== null)
      : [],
    catalog: Array.isArray(value.catalog)
      ? value.catalog.map(normalizeCatalogItem).filter((item): item is CatalogItem => item !== null)
      : [],
    mappers: mapValues(value.mappers, normalizeMapper),
    matches: mapValues(value.matches, normalizeMatch),
    confirmed: mapValues(value.confirmed, (item) => {
      if (!isPlain(item)) return null;
      const supplier = String(item.supplier ?? "");
      const price = Number(item.price);
      if (!supplier || !Number.isFinite(price)) return null;
      return { supplier, price, date: String(item.date ?? "") };
    }),
    absent: mapValues(value.absent, (item) => (typeof item === "string" ? item : null)),
    cleared: mapValues(value.cleared, (item) => (item === true ? true : null)),
    seen: mapValues(value.seen, (item) => {
      const count = Number(item);
      return Number.isFinite(count) ? count : null;
    }),
    seenReady: Boolean(value.seenReady),
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch {
    return "Не удалось сохранить данные: память браузера заполнена.";
  }
}
