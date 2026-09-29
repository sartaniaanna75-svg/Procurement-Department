import type { CatalogItem } from "../types";
import { normalizeText } from "./text";

export function matchesQuery(fields: string[], query: string): boolean {
  const parts = normalizeText(query).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  const haystack = normalizeText(fields.join(" "));
  return parts.every((part) => haystack.includes(part));
}

export function searchCatalog(catalog: CatalogItem[], query: string): CatalogItem[] {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  return catalog.filter((item) => matchesQuery([item.name, item.unit, item.code, item.barcode ?? ""], trimmed)).slice(0, 30);
}
