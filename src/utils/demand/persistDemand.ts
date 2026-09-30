import type { DivisionId } from "../divisions";
import { emptyDemandWorkspace, type DemandWorkspace } from "./types";

const DB_NAME = "zakazy";
const DB_VERSION = 1;
const STORE = "documents";

function divisionKey(division: DivisionId, key: string): string {
  return `${division}/${key}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["catalog", "prices", "matching", "suppliers", "documents"] as const) {
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

function normalizeWorkspace(value: unknown): DemandWorkspace {
  const base = emptyDemandWorkspace();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<DemandWorkspace>;
  return {
    version: 1,
    sources: raw.sources && typeof raw.sources === "object" ? { ...raw.sources } : {},
    stock: Array.isArray(raw.stock) ? raw.stock : [],
    turnover: Array.isArray(raw.turnover) ? raw.turnover : [],
    control: Array.isArray(raw.control) ? raw.control : [],
    packOverrides: raw.packOverrides && typeof raw.packOverrides === "object" ? { ...raw.packOverrides } : {},
    decisions: raw.decisions && typeof raw.decisions === "object" ? { ...raw.decisions } : {},
    includeExpectedReceipts: Boolean(raw.includeExpectedReceipts),
  };
}

export async function loadDemandWorkspace(division: DivisionId): Promise<DemandWorkspace> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE], "readonly");
    const raw = await requestResult(transaction.objectStore(STORE).get(divisionKey(division, "demand")));
    await transactionDone(transaction);
    return normalizeWorkspace(raw);
  } finally {
    db.close();
  }
}

export async function saveDemandWorkspace(division: DivisionId, workspace: DemandWorkspace): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([STORE], "readwrite");
    transaction.objectStore(STORE).put({ ...workspace, version: 1 }, divisionKey(division, "demand"));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export function demandHasCoreData(workspace: DemandWorkspace): boolean {
  return workspace.stock.length > 0 || workspace.turnover.length > 0;
}
