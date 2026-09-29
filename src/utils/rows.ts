import type { CatalogItem, DisplayRow, PriceTuple, Upload } from "../types";

export function matchKey(supplier: string, name: string, code: string, barcode: string, unit: string): string {
  return [supplier, name, code, barcode, unit]
    .map((part) => part.trim().toLowerCase().replace(/ё/g, "е"))
    .join("\u001f");
}

export function toRow(tuple: PriceTuple): DisplayRow {
  const [
    supplier,
    name,
    price,
    barcode,
    code,
    unit,
    file,
    stock = "",
    pack = "",
    multiplicity = "",
    supplierCode = "",
    volume = "",
  ] = tuple;
  return {
    key: matchKey(supplier, name, code, barcode, unit),
    supplierId: "",
    supplier,
    name,
    price,
    barcode,
    code,
    unit,
    file,
    stock,
    pack,
    multiplicity,
    supplierCode,
    volume,
  };
}

export function listRows(uploads: Upload[]): DisplayRow[] {
  const sorted = [...uploads].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const map = new Map<string, DisplayRow>();
  for (const upload of sorted) {
    for (const tuple of upload.rows) {
      const row = toRow(tuple);
      map.set(row.key, { ...row, supplierId: upload.supplierId || row.supplierId });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru") || a.supplier.localeCompare(b.supplier, "ru"));
}

export interface SupplierSummary {
  supplier: string;
  count: number;
  uploadedAt: string;
}

export function summarizeSuppliers(uploads: Upload[]): SupplierSummary[] {
  const rows = listRows(uploads);
  const dates = new Map<string, string>();
  for (const upload of uploads) {
    const names = new Set(upload.rows.map((tuple) => tuple[0]));
    for (const name of names) {
      const previous = dates.get(name) ?? "";
      if (upload.uploadedAt > previous) dates.set(name, upload.uploadedAt);
    }
  }
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.supplier, (counts.get(row.supplier) ?? 0) + 1);
  return [...counts.entries()]
    .map(([supplier, count]) => ({
      supplier,
      count,
      uploadedAt: dates.get(supplier) ?? "",
    }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier, "ru"));
}

export function ourNomenclature(code: string, catalog: Map<string, CatalogItem>): string {
  if (!code) return "—";
  const item = catalog.get(code);
  if (!item) return `Код ${code}`;
  return item.unit ? `${item.name} · ${item.unit}` : item.name;
}

export function catalogMap(items: CatalogItem[]): Map<string, CatalogItem> {
  const map = new Map<string, CatalogItem>();
  for (const item of items) {
    if (!map.has(item.code)) map.set(item.code, item);
  }
  return map;
}
