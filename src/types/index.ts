export type MatchStatus = "need" | "confirmed" | "picked" | "missing";

export type PriceFilter = "all" | "need" | "confirmed" | "missing";

export type MatchFilter = "need" | "confirmed" | "missing" | "resolved";

/** supplier, name, price, barcode, code, unit, filename, stock, pack, multiplicity, supplierCode, volume */
export type PriceTuple = [
  string,
  string,
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export interface ColumnLabels {
  name: string;
  price: string;
  barcode: string;
  stock: string;
  unit: string;
  pack: string;
  multiplicity: string;
  supplierCode: string;
}

export interface Upload {
  file: string;
  supplier: string;
  uploadedAt: string;
  rows: PriceTuple[];
}

export interface CatalogItem {
  code: string;
  name: string;
  unit: string;
}

export interface ColumnMapper {
  headerRow: number;
  name: number;
  price: number;
  barcode: number;
  code: number;
  unit: number;
  stock: number;
  pack: number;
  multiplicity: number;
  volume: number;
  labels: ColumnLabels;
  headerSignature: string[];
}

export interface MatchDecision {
  status: MatchStatus;
  code: string;
  confidence: number;
  reason: string;
}

export interface ConfirmedChoice {
  supplier: string;
  price: number;
  date: string;
}

export interface AppState {
  uploads: Upload[];
  catalog: CatalogItem[];
  mappers: Record<string, ColumnMapper>;
  matches: Record<string, MatchDecision>;
  confirmed: Record<string, ConfirmedChoice>;
  absent: Record<string, string>;
  cleared: Record<string, boolean>;
  seen: Record<string, number>;
  seenReady: boolean;
}

export interface DisplayRow {
  key: string;
  supplier: string;
  name: string;
  price: number;
  barcode: string;
  code: string;
  unit: string;
  file: string;
  stock: string;
  pack: string;
  multiplicity: string;
  supplierCode: string;
  volume: string;
}

export const EMPTY_MATCH: MatchDecision = {
  status: "need",
  code: "",
  confidence: 0,
  reason: "",
};

export const STORAGE_KEY = "zakazy-state";
