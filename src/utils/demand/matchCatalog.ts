import type { CatalogItem } from "../../types";
import { barcodeFromCell } from "../catalogUpdate";
import { normalizeText, normCode } from "../text";
import type { DemandIdentity } from "./types";

export type MatchMethod = "code" | "barcode" | "name" | null;

export interface CatalogMatchResult {
  item: CatalogItem | null;
  method: MatchMethod;
  ambiguous: boolean;
}

function nameKey(name: string): string {
  return normalizeText(name).replace(/\s+/g, " ");
}

export function buildCatalogIndexes(catalog: CatalogItem[]): {
  byCode: Map<string, CatalogItem[]>;
  byBarcode: Map<string, CatalogItem[]>;
  byName: Map<string, CatalogItem[]>;
} {
  const byCode = new Map<string, CatalogItem[]>();
  const byBarcode = new Map<string, CatalogItem[]>();
  const byName = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    const code = normCode(item.code);
    if (code) {
      const list = byCode.get(code) ?? [];
      list.push(item);
      byCode.set(code, list);
    }
    const barcode = item.barcode ? barcodeFromCell(item.barcode) : "";
    if (barcode) {
      const list = byBarcode.get(barcode) ?? [];
      list.push(item);
      byBarcode.set(barcode, list);
    }
    const name = nameKey(item.name);
    if (name) {
      const list = byName.get(name) ?? [];
      list.push(item);
      byName.set(name, list);
    }
  }
  return { byCode, byBarcode, byName };
}

function uniqueOrAmbiguous(list: CatalogItem[] | undefined): CatalogMatchResult {
  if (!list || list.length === 0) return { item: null, method: null, ambiguous: false };
  if (list.length === 1) return { item: list[0], method: null, ambiguous: false };
  return { item: null, method: null, ambiguous: true };
}

/** Приоритет: код 1С → штрихкод → точное нормализованное имя. */
export function matchIdentityToCatalog(
  identity: DemandIdentity,
  indexes: ReturnType<typeof buildCatalogIndexes>,
): CatalogMatchResult {
  const code = normCode(identity.code);
  if (code) {
    const byCode = uniqueOrAmbiguous(indexes.byCode.get(code));
    if (byCode.ambiguous) return { item: null, method: "code", ambiguous: true };
    if (byCode.item) return { item: byCode.item, method: "code", ambiguous: false };
  }

  const barcode = identity.barcode ? barcodeFromCell(identity.barcode) : "";
  if (barcode) {
    const byBarcode = uniqueOrAmbiguous(indexes.byBarcode.get(barcode));
    if (byBarcode.ambiguous) return { item: null, method: "barcode", ambiguous: true };
    if (byBarcode.item) return { item: byBarcode.item, method: "barcode", ambiguous: false };
  }

  const name = nameKey(identity.name);
  if (name) {
    const byName = uniqueOrAmbiguous(indexes.byName.get(name));
    if (byName.ambiguous) return { item: null, method: "name", ambiguous: true };
    if (byName.item) return { item: byName.item, method: "name", ambiguous: false };
  }

  return { item: null, method: null, ambiguous: false };
}
