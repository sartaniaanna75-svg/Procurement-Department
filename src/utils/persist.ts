import type { AppState } from "../types";
import { STORAGE_KEY } from "../types";
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

async function readDatabase(): Promise<AppState | null> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([...STORE_NAMES], "readonly");
    const catalogRequest = transaction.objectStore("catalog").get("items");
    const previousRequest = transaction.objectStore("catalog").get("previous");
    const metaRequest = transaction.objectStore("catalog").get("meta");
    const pricesRequest = transaction.objectStore("prices").get("current");
    const matchingRequest = transaction.objectStore("matching").get("decisions");
    const suppliersRequest = transaction.objectStore("suppliers").get("cards");
    const documentsRequest = transaction.objectStore("documents").get("orders");
    const catalog = await requestResult(catalogRequest);
    const previousCatalog = await requestResult(previousRequest);
    const meta = await requestResult<{ catalogUpdatedAt?: string; catalogImportMeta?: AppState["catalogImportMeta"]; catalogUpdateSummary?: AppState["catalogUpdateSummary"] } | undefined>(metaRequest);
    const prices = await requestResult<Record<string, unknown> | undefined>(pricesRequest);
    const matching = await requestResult<Record<string, unknown> | undefined>(matchingRequest);
    const suppliers = await requestResult<Record<string, unknown> | undefined>(suppliersRequest);
    const documents = await requestResult<Record<string, unknown> | undefined>(documentsRequest);
    await transactionDone(transaction);
    if (catalog === undefined && !prices && !matching && !suppliers && !documents) return null;
    return normalizeState({
      catalog: catalog ?? [],
      previousCatalog: previousCatalog ?? [],
      catalogUpdatedAt: meta?.catalogUpdatedAt ?? "",
      catalogImportMeta: meta?.catalogImportMeta ?? null,
      catalogUpdateSummary: meta?.catalogUpdateSummary ?? null,
      uploads: prices?.uploads ?? [],
      heldPrices: prices?.heldPrices ?? [],
      notInPrice: prices?.notInPrice ?? {},
      priceHistory: prices?.priceHistory ?? {},
      matches: matching?.matches ?? {},
      productMemory: matching?.productMemory ?? {},
      reviewPasses: matching?.reviewPasses ?? {},
      confirmed: matching?.confirmed ?? {},
      absent: matching?.absent ?? {},
      cleared: matching?.cleared ?? {},
      seen: matching?.seen ?? {},
      seenReady: matching?.seenReady ?? false,
      matchLogic: matching?.matchLogic ?? 0,
      suppliers: suppliers?.suppliers ?? [],
      mappers: suppliers?.mappers ?? {},
      purchaseNeed: suppliers?.purchaseNeed ?? {},
      draftOrders: documents?.draftOrders ?? [],
      priceWatch: documents?.priceWatch ?? [],
    });
  } finally {
    db.close();
  }
}

type PersistStore = (typeof STORE_NAMES)[number];

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

async function writeDatabase(state: AppState, stores: PersistStore[] = [...STORE_NAMES]): Promise<void> {
  if (stores.length === 0) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(stores, "readwrite");
    if (stores.includes("catalog")) {
      transaction.objectStore("catalog").put(state.catalog, "items");
      transaction.objectStore("catalog").put(state.previousCatalog, "previous");
      transaction.objectStore("catalog").put(
        { catalogUpdatedAt: state.catalogUpdatedAt, catalogImportMeta: state.catalogImportMeta, catalogUpdateSummary: state.catalogUpdateSummary },
        "meta",
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
        "current",
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
        "decisions",
      );
    }
    if (stores.includes("suppliers")) {
      transaction.objectStore("suppliers").put({ suppliers: state.suppliers, mappers: state.mappers, purchaseNeed: state.purchaseNeed }, "cards");
    }
    if (stores.includes("documents")) {
      transaction.objectStore("documents").put({ draftOrders: state.draftOrders, priceWatch: state.priceWatch }, "orders");
    }
    await transactionDone(transaction);
  } finally {
    db.close();
  }
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

function rememberPlace(): void {
  localStorage.setItem(META_KEY, JSON.stringify({ place: "indexeddb" }));
}

function removeLegacy(): void {
  localStorage.removeItem(STORAGE_KEY);
  rememberPlace();
}

async function migrateLegacy(legacy: AppState): Promise<AppState | null> {
  try {
    await writeDatabase(legacy);
    const back = await readDatabase();
    if (!back || !sameSnapshot(legacy, back)) {
      await clearDatabase();
      return null;
    }
    removeLegacy();
    return back;
  } catch {
    return null;
  }
}

export async function loadPersistedState(): Promise<AppState> {
  const legacy = readLegacyState();
  let stored: AppState | null = null;
  try {
    stored = await readDatabase();
  } catch {
    return legacy ?? emptyState();
  }
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
let lastFingerprints: Record<PersistStore, string> | null = null;

export async function savePersistedState(state: AppState): Promise<string | null> {
  const ticket = ++latestTicket;
  const job = writeQueue.then(async () => {
    if (ticket !== latestTicket) return null;
    let existing: AppState | null = null;
    try {
      existing = await readDatabase();
    } catch {
      existing = null;
    }
    const safe = protectIndependentData(state, existing);
    const nextFp = persistStoreFingerprints(safe);
    const prevFp = lastFingerprints ?? (existing ? persistStoreFingerprints(existing) : null);
    let stores = changedPersistStores(prevFp, nextFp);
    // Никогда не затираем непустые прайсы/поставщиков пустой записью.
    if (stores.includes("prices") && safe.uploads.length === 0 && existing && existing.uploads.length > 0) {
      stores = stores.filter((name) => name !== "prices");
    }
    if (stores.includes("suppliers") && safe.suppliers.length === 0 && existing && existing.suppliers.length > 0) {
      stores = stores.filter((name) => name !== "suppliers");
    }
    if (stores.length > 0) await writeDatabase(safe, stores);
    const merged = { ...(prevFp ?? nextFp) };
    for (const name of stores) merged[name] = nextFp[name];
    if (!stores.includes("prices") && existing && existing.uploads.length > 0) {
      merged.prices = persistStoreFingerprints(existing).prices;
    }
    if (!stores.includes("suppliers") && existing && existing.suppliers.length > 0) {
      merged.suppliers = persistStoreFingerprints(existing).suppliers;
    }
    lastFingerprints = merged;
    rememberPlace();
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
