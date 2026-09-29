import type { AppState } from "../types";
import { STORAGE_KEY } from "../types";
import {
  DEFAULT_DIVISION,
  emptyDivisionConnections,
  isDivisionId,
  type DivisionConnections,
  type DivisionId,
} from "./divisions";
import { emptyState, normalizeState } from "./storage";

const DB_NAME = "zakazy";
const DB_VERSION = 1;
const META_KEY = "zakazy-storage";
const STORE_NAMES = ["catalog", "prices", "matching", "suppliers", "documents"] as const;

interface DataSnapshot {
  catalog: number;
  first: string;
  last: string;
  matches: number;
  confirmed: number;
  suppliers: string;
  rows: string;
  rowCount: number;
  held: string;
  heldCount: number;
}

type PersistStore = (typeof STORE_NAMES)[number];

function divisionKey(division: DivisionId, key: string): string {
  return `${division}/${key}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Запись прервана"));
  });
}

function assembleState(parts: {
  catalog: unknown;
  previousCatalog: unknown;
  meta: { catalogUpdatedAt?: string; catalogImportMeta?: AppState["catalogImportMeta"]; catalogUpdateSummary?: AppState["catalogUpdateSummary"] } | undefined;
  prices: Record<string, unknown> | undefined;
  matching: Record<string, unknown> | undefined;
  suppliers: Record<string, unknown> | undefined;
  documents: Record<string, unknown> | undefined;
}): AppState {
  return normalizeState({
    catalog: parts.catalog ?? [],
    previousCatalog: parts.previousCatalog ?? [],
    catalogUpdatedAt: parts.meta?.catalogUpdatedAt ?? "",
    catalogImportMeta: parts.meta?.catalogImportMeta ?? null,
    catalogUpdateSummary: parts.meta?.catalogUpdateSummary ?? null,
    uploads: parts.prices?.uploads ?? [],
    heldPrices: parts.prices?.heldPrices ?? [],
    notInPrice: parts.prices?.notInPrice ?? {},
    priceHistory: parts.prices?.priceHistory ?? {},
    matches: parts.matching?.matches ?? {},
    productMemory: parts.matching?.productMemory ?? {},
    reviewPasses: parts.matching?.reviewPasses ?? {},
    confirmed: parts.matching?.confirmed ?? {},
    absent: parts.matching?.absent ?? {},
    cleared: parts.matching?.cleared ?? {},
    seen: parts.matching?.seen ?? {},
    seenReady: parts.matching?.seenReady ?? false,
    matchLogic: parts.matching?.matchLogic ?? 0,
    suppliers: parts.suppliers?.suppliers ?? [],
    mappers: parts.suppliers?.mappers ?? {},
    purchaseNeed: parts.suppliers?.purchaseNeed ?? {},
    draftOrders: parts.documents?.draftOrders ?? [],
    priceWatch: parts.documents?.priceWatch ?? [],
  });
}

function stateLooksEmpty(state: AppState): boolean {
  return (
    state.catalog.length === 0 &&
    state.uploads.length === 0 &&
    state.suppliers.length === 0 &&
    Object.keys(state.matches).length === 0 &&
    Object.keys(state.productMemory).length === 0
  );
}

async function readKeys(
  db: IDBDatabase,
  map: (key: string) => string,
): Promise<{
  catalog: unknown;
  previousCatalog: unknown;
  meta: { catalogUpdatedAt?: string; catalogImportMeta?: AppState["catalogImportMeta"]; catalogUpdateSummary?: AppState["catalogUpdateSummary"] } | undefined;
  prices: Record<string, unknown> | undefined;
  matching: Record<string, unknown> | undefined;
  suppliers: Record<string, unknown> | undefined;
  documents: Record<string, unknown> | undefined;
  connections: DivisionConnections | undefined;
  any: boolean;
}> {
  const transaction = db.transaction([...STORE_NAMES], "readonly");
  const catalog = await requestResult(transaction.objectStore("catalog").get(map("items")));
  const previousCatalog = await requestResult(transaction.objectStore("catalog").get(map("previous")));
  const meta = await requestResult(transaction.objectStore("catalog").get(map("meta")));
  const prices = await requestResult(transaction.objectStore("prices").get(map("current")));
  const matching = await requestResult(transaction.objectStore("matching").get(map("decisions")));
  const suppliers = await requestResult(transaction.objectStore("suppliers").get(map("cards")));
  const documents = await requestResult(transaction.objectStore("documents").get(map("orders")));
  const settings = await requestResult(transaction.objectStore("documents").get(map("settings")));
  await transactionDone(transaction);
  const any =
    catalog !== undefined ||
    previousCatalog !== undefined ||
    meta !== undefined ||
    Boolean(prices) ||
    Boolean(matching) ||
    Boolean(suppliers) ||
    Boolean(documents) ||
    Boolean(settings);
  const connections =
    settings && typeof settings === "object" && "connections" in settings
      ? normalizeConnections((settings as { connections?: unknown }).connections)
      : undefined;
  return {
    catalog,
    previousCatalog,
    meta: meta as { catalogUpdatedAt?: string; catalogImportMeta?: AppState["catalogImportMeta"]; catalogUpdateSummary?: AppState["catalogUpdateSummary"] } | undefined,
    prices: prices as Record<string, unknown> | undefined,
    matching: matching as Record<string, unknown> | undefined,
    suppliers: suppliers as Record<string, unknown> | undefined,
    documents: documents as Record<string, unknown> | undefined,
    connections,
    any,
  };
}

function normalizeConnections(value: unknown): DivisionConnections {
  const base = emptyDivisionConnections();
  if (!value || typeof value !== "object") return base;
  const raw = value as Record<string, unknown>;
  const email = raw.emailConnection && typeof raw.emailConnection === "object" ? (raw.emailConnection as Record<string, unknown>) : {};
  const oneC = raw.oneCConnection && typeof raw.oneCConnection === "object" ? (raw.oneCConnection as Record<string, unknown>) : {};
  return {
    emailConnection: {
      configured: Boolean(email.configured),
      label: String(email.label ?? ""),
    },
    oneCConnection: {
      configured: Boolean(oneC.configured),
      label: String(oneC.label ?? ""),
    },
  };
}

async function readDivisionRaw(division: DivisionId): Promise<{ state: AppState | null; connections: DivisionConnections }> {
  const db = await openDatabase();
  try {
    const prefixed = await readKeys(db, (key) => divisionKey(division, key));
    if (prefixed.any) {
      return {
        state: assembleState(prefixed),
        connections: prefixed.connections ?? emptyDivisionConnections(),
      };
    }
    // Однократная миграция: старые ключи без префикса → Володарского.
    if (division === DEFAULT_DIVISION) {
      const legacy = await readKeys(db, (key) => key);
      if (legacy.any) {
        const state = assembleState(legacy);
        await writeDivisionState(state, DEFAULT_DIVISION, [...STORE_NAMES], emptyDivisionConnections());
        return { state, connections: emptyDivisionConnections() };
      }
    }
    return { state: null, connections: emptyDivisionConnections() };
  } finally {
    db.close();
  }
}

async function writeDivisionState(
  state: AppState,
  division: DivisionId,
  stores: PersistStore[] = [...STORE_NAMES],
  connections?: DivisionConnections,
): Promise<void> {
  if (stores.length === 0 && connections === undefined) return;
  const db = await openDatabase();
  try {
    const names = connections !== undefined && !stores.includes("documents") ? [...stores, "documents" as const] : stores;
    if (names.length === 0) return;
    const transaction = db.transaction(names, "readwrite");
    const k = (key: string) => divisionKey(division, key);
    if (stores.includes("catalog")) {
      transaction.objectStore("catalog").put(state.catalog, k("items"));
      transaction.objectStore("catalog").put(state.previousCatalog, k("previous"));
      transaction.objectStore("catalog").put(
        { catalogUpdatedAt: state.catalogUpdatedAt, catalogImportMeta: state.catalogImportMeta, catalogUpdateSummary: state.catalogUpdateSummary },
        k("meta"),
      );
    }
    if (stores.includes("prices")) {
      transaction.objectStore("prices").put(
        {
          uploads: state.uploads,
          heldPrices: state.heldPrices,
          notInPrice: state.notInPrice,
          priceHistory: state.priceHistory,
        },
        k("current"),
      );
    }
    if (stores.includes("matching")) {
      transaction.objectStore("matching").put(
        {
          matches: state.matches,
          productMemory: state.productMemory,
          reviewPasses: state.reviewPasses,
          confirmed: state.confirmed,
          absent: state.absent,
          cleared: state.cleared,
          seen: state.seen,
          seenReady: state.seenReady,
          matchLogic: state.matchLogic,
        },
        k("decisions"),
      );
    }
    if (stores.includes("suppliers")) {
      transaction.objectStore("suppliers").put({ suppliers: state.suppliers, mappers: state.mappers, purchaseNeed: state.purchaseNeed }, k("cards"));
    }
    if (stores.includes("documents")) {
      transaction.objectStore("documents").put({ draftOrders: state.draftOrders, priceWatch: state.priceWatch }, k("orders"));
    }
    if (connections !== undefined) {
      transaction.objectStore("documents").put({ connections }, k("settings"));
    }
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** Отпечатки независимых блоков данных: каталог ≠ прайсы ≠ поставщики. */
export function persistStoreFingerprints(state: AppState): Record<PersistStore, string> {
  return {
    catalog: [
      state.catalog.length,
      itemMark(state.catalog[0]),
      itemMark(state.catalog[state.catalog.length - 1]),
      state.previousCatalog.length,
      state.catalogUpdatedAt,
      JSON.stringify(state.catalogImportMeta),
      JSON.stringify(state.catalogUpdateSummary),
    ].join("|"),
    prices: [
      state.uploads.map((upload) => `${upload.supplierId}:${upload.file}:${upload.rows.length}:${upload.versionId}`).join(";"),
      state.heldPrices.map((upload) => `${upload.versionId}:${upload.rows.length}`).join(";"),
      Object.keys(state.notInPrice).sort().join(","),
      Object.keys(state.priceHistory).length,
    ].join("|"),
    matching: [
      Object.entries(state.matches)
        .map(([key, decision]) => `${key}:${decision.status}:${decision.code}`)
        .sort()
        .join(";"),
      Object.keys(state.productMemory).sort().join(","),
      Object.keys(state.confirmed).length,
      Object.keys(state.absent).length,
      state.matchLogic,
      state.seenReady ? 1 : 0,
    ].join("|"),
    suppliers: [
      state.suppliers.map((card) => `${card.id}:${card.name}:${card.orderDays.join(",")}:${card.purchaseMode}:${card.oneC.guid}`).join(";"),
      Object.keys(state.mappers).length,
      Object.keys(state.purchaseNeed).sort().join(","),
    ].join("|"),
    documents: [`${state.draftOrders.length}`, `${state.priceWatch.length}`].join("|"),
  };
}

export function changedPersistStores(previous: Record<PersistStore, string> | null, next: Record<PersistStore, string>): PersistStore[] {
  if (!previous) return [...STORE_NAMES];
  return STORE_NAMES.filter((name) => previous[name] !== next[name]);
}

/**
 * Защита независимых сущностей: пустые прайсы/поставщики из React-состояния
 * не должны затирать уже сохранённые в IndexedDB данные.
 */
export function protectIndependentData(incoming: AppState, existing: AppState | null): AppState {
  if (!existing) return incoming;
  let next = incoming;
  if (incoming.uploads.length === 0 && existing.uploads.length > 0) {
    next = {
      ...next,
      uploads: existing.uploads,
      heldPrices: existing.heldPrices,
      notInPrice: Object.keys(incoming.notInPrice).length > 0 ? incoming.notInPrice : existing.notInPrice,
      priceHistory: Object.keys(incoming.priceHistory).length > 0 ? incoming.priceHistory : existing.priceHistory,
    };
  }
  if (incoming.suppliers.length === 0 && existing.suppliers.length > 0) {
    next = {
      ...next,
      suppliers: existing.suppliers,
      mappers: Object.keys(incoming.mappers).length > 0 ? incoming.mappers : existing.mappers,
      purchaseNeed: Object.keys(incoming.purchaseNeed).length > 0 ? incoming.purchaseNeed : existing.purchaseNeed,
    };
  }
  if (Object.keys(incoming.productMemory).length === 0 && Object.keys(existing.productMemory).length > 0) {
    next = { ...next, productMemory: existing.productMemory };
  }
  return next;
}

/** После обновления каталога явно оставляем прайсы, поставщиков и документы без изменений. */
export function keepSupplierPriceIslands(from: AppState, to: AppState): AppState {
  return {
    ...to,
    uploads: from.uploads,
    heldPrices: from.heldPrices,
    suppliers: from.suppliers,
    mappers: from.mappers,
    purchaseNeed: from.purchaseNeed,
    notInPrice: from.notInPrice,
    priceHistory: from.priceHistory,
    draftOrders: from.draftOrders,
    priceWatch: from.priceWatch,
  };
}

async function clearDatabase(): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([...STORE_NAMES], "readwrite");
    for (const name of STORE_NAMES) transaction.objectStore(name).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export function readLegacyState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function itemMark(item: { code?: string; name?: string } | undefined): string {
  if (!item) return "";
  return `${item.code ?? ""}|${item.name ?? ""}`;
}

export function dataSnapshot(state: AppState): DataSnapshot {
  const catalog = state.catalog;
  return {
    catalog: catalog.length,
    first: itemMark(catalog[0]),
    last: itemMark(catalog[catalog.length - 1]),
    matches: Object.keys(state.matches).length,
    confirmed: Object.keys(state.confirmed).length,
    suppliers: state.suppliers.map((card) => `${card.id}:${card.name}:${card.orderDays.join(",")}:${card.oneC.guid}`).join(";"),
    rows: state.uploads.map((upload) => `${upload.supplierId}:${upload.file}:${upload.rows.length}:${upload.versionId}`).join("|"),
    rowCount: state.uploads.reduce((sum, upload) => sum + upload.rows.length, 0),
    held: state.heldPrices.map((upload) => `${upload.versionId}:${upload.rows.length}`).join("|"),
    heldCount: state.heldPrices.reduce((sum, upload) => sum + upload.rows.length, 0),
  };
}

function sameSnapshot(left: AppState, right: AppState): boolean {
  return JSON.stringify(dataSnapshot(left)) === JSON.stringify(dataSnapshot(right));
}

function covers(newer: DataSnapshot, older: DataSnapshot): boolean {
  return newer.catalog >= older.catalog && newer.matches >= older.matches && newer.confirmed >= older.confirmed && newer.rowCount >= older.rowCount && newer.heldCount >= older.heldCount && newer.suppliers.length >= older.suppliers.length;
}

export function readActiveDivision(): DivisionId {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return DEFAULT_DIVISION;
    const parsed = JSON.parse(raw) as { activeDivision?: unknown };
    return isDivisionId(parsed.activeDivision) ? parsed.activeDivision : DEFAULT_DIVISION;
  } catch {
    return DEFAULT_DIVISION;
  }
}

function rememberPlace(activeDivision: DivisionId = readActiveDivision()): void {
  localStorage.setItem(META_KEY, JSON.stringify({ place: "indexeddb", activeDivision }));
}

export function rememberActiveDivision(activeDivision: DivisionId): void {
  rememberPlace(activeDivision);
}

function removeLegacy(): void {
  localStorage.removeItem(STORAGE_KEY);
  rememberPlace();
}

async function migrateLegacy(legacy: AppState): Promise<AppState | null> {
  try {
    await writeDivisionState(legacy, DEFAULT_DIVISION, [...STORE_NAMES], emptyDivisionConnections());
    const back = await loadDivisionState(DEFAULT_DIVISION);
    if (!sameSnapshot(legacy, back)) {
      await clearDatabase();
      return null;
    }
    removeLegacy();
    return back;
  } catch {
    return null;
  }
}

/** Загрузить данные одного подразделения. Территория без записей → пустое состояние. */
export async function loadDivisionState(division: DivisionId): Promise<AppState> {
  const { state } = await readDivisionRaw(division);
  return state ?? emptyState();
}

export async function loadDivisionConnections(division: DivisionId): Promise<DivisionConnections> {
  const { connections } = await readDivisionRaw(division);
  return connections;
}

/**
 * Первичная загрузка активного подразделения.
 * Все прежние данные мигрируют в Володарского; Территория остаётся пустой до первого сохранения.
 */
export async function loadPersistedState(division: DivisionId = readActiveDivision()): Promise<AppState> {
  const legacy = readLegacyState();
  let stored: AppState | null = null;
  try {
    const raw = await readDivisionRaw(division);
    stored = raw.state;
  } catch {
    return legacy && division === DEFAULT_DIVISION ? legacy : emptyState();
  }
  if (division !== DEFAULT_DIVISION) return stored ?? emptyState();
  if (!legacy && !stored) return emptyState();
  if (!legacy && stored) return stored;
  if (legacy && !stored) return (await migrateLegacy(legacy)) ?? legacy;
  if (!legacy || !stored) return stored ?? legacy ?? emptyState();
  if (sameSnapshot(legacy, stored) || covers(dataSnapshot(stored), dataSnapshot(legacy))) {
    removeLegacy();
    return stored;
  }
  if (covers(dataSnapshot(legacy), dataSnapshot(stored))) return (await migrateLegacy(legacy)) ?? legacy;
  return legacy;
}

let writeQueue: Promise<void> = Promise.resolve();
let latestTicket = 0;
const lastFingerprintsByDivision: Partial<Record<DivisionId, Record<PersistStore, string>>> = {};

/** Сохранить состояние только выбранного подразделения. */
export async function savePersistedState(state: AppState, division: DivisionId = readActiveDivision()): Promise<string | null> {
  const ticket = ++latestTicket;
  const job = writeQueue.then(async () => {
    if (ticket !== latestTicket) return null;
    let existing: AppState | null = null;
    try {
      existing = await loadDivisionState(division);
      if (stateLooksEmpty(existing)) existing = null;
    } catch {
      existing = null;
    }
    const safe = protectIndependentData(state, existing);
    const nextFp = persistStoreFingerprints(safe);
    const prevFp = lastFingerprintsByDivision[division] ?? (existing ? persistStoreFingerprints(existing) : null);
    let stores = changedPersistStores(prevFp, nextFp);
    if (stores.includes("prices") && safe.uploads.length === 0 && existing && existing.uploads.length > 0) {
      stores = stores.filter((name) => name !== "prices");
    }
    if (stores.includes("suppliers") && safe.suppliers.length === 0 && existing && existing.suppliers.length > 0) {
      stores = stores.filter((name) => name !== "suppliers");
    }
    if (stores.length > 0) await writeDivisionState(safe, division, stores);
    const merged = { ...(prevFp ?? nextFp) };
    for (const name of stores) merged[name] = nextFp[name];
    if (!stores.includes("prices") && existing && existing.uploads.length > 0) {
      merged.prices = persistStoreFingerprints(existing).prices;
    }
    if (!stores.includes("suppliers") && existing && existing.suppliers.length > 0) {
      merged.suppliers = persistStoreFingerprints(existing).suppliers;
    }
    lastFingerprintsByDivision[division] = merged;
    rememberPlace(division);
    return null;
  });
  writeQueue = job.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await job;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "QuotaExceededError") return "Не удалось сохранить данные: память браузера заполнена.";
    return "Не удалось сохранить данные.";
  }
}

/** Сохранить несекретные заготовки подключений подразделения. */
export async function saveDivisionConnections(division: DivisionId, connections: DivisionConnections): Promise<void> {
  await writeDivisionState(emptyState(), division, [], connections);
}
