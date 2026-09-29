export type MatchStatus = "need" | "confirmed" | "picked" | "missing" | "rejected" | "review";

export type PriceFilter = "all" | "need" | "confirmed" | "missing";

export type MatchFilter = "need" | "confirmed" | "missing" | "resolved" | "rejected" | "review";

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
  supplierId: string;
  uploadedAt: string;
  cycleDate: string;
  versionId: string;
  rows: PriceTuple[];
}

/** 1 — понедельник … 7 — воскресенье */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface OneCLink {
  name: string;
  guid: string;
  partner: string;
  partnerGuid: string;
  counterparty: string;
  counterpartyGuid: string;
  agreement: string;
  agreementGuid: string;
  contract: string;
  contractGuid: string;
  organization: string;
  organizationGuid: string;
}

export interface ReminderStage {
  id: string;
  hoursBeforeDeadline: number;
}

export interface SupplierSchedule {
  expectFrom: IsoWeekday | null;
  expectTo: IsoWeekday | null;
  deadlineWeekday: IsoWeekday | null;
  deadlineTime: string;
  validityDays: number | null;
  reminders: ReminderStage[];
}

/** Откуда берётся предложение. Сайт и ручной источник не требуют файла прайса. */
export type OfferSource = "price" | "site" | "manual" | "api";

/** Режим закупки. Расчёт по режиму — отдельная задача, карточка только хранит выбор. */
export type PurchaseMode = "schedule" | "demand" | "manual" | "mixed";

export interface SupplierCard {
  id: string;
  name: string;
  fullName: string;
  comment: string;
  active: boolean;
  responsible: string;
  orderDays: IsoWeekday[];
  offerSource: OfferSource;
  purchaseMode: PurchaseMode;
  aliases: string[];
  priceNames: string[];
  emails: string[];
  inns: string[];
  fileHints: string[];
  sheetHints: string[];
  structureHint: string;
  oneC: OneCLink;
  schedule: SupplierSchedule;
}

export interface NotInPriceItem {
  supplierId: string;
  name: string;
  barcode: string;
  code: string;
  unit: string;
  lastPrice: number;
  lastSeenAt: string;
}

export interface PricePoint {
  at: string;
  price: number;
  versionId: string;
}

/** Черновик будущего заказа. В 1С сам не уходит. */
export interface DraftOrder {
  id: string;
  supplierId: string;
  cycleDate: string;
  priceVersionId: string;
  status: "draft";
  createdAt: string;
}

/** Новый прайс пришёл после черновика. Пересчёт делает менеджер, не программа. */
export interface PriceWatch {
  supplierId: string;
  cycleDate: string;
  draftId: string;
  previousVersionId: string;
  nextVersionId: string;
  receivedAt: string;
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

/** Устойчивые признаки товара поставщика. Код поставщика сюда не входит. */
export interface ProductTraits {
  barcode: string;
  name: string;
  brands: string[];
  kind: string;
  purpose: string;
  variants: string[];
  ml: number;
  g: number;
  pack: string;
  unit: string;
}

/** Постоянное решение по товару поставщика. Не зависит от актуального прайса. */
export interface ProductMemory {
  id: string;
  supplierId: string;
  supplier: string;
  verdict: "rejected" | "matched";
  catalogCode: string;
  matchStatus: "confirmed" | "picked" | "";
  reason: string;
  traits: ProductTraits;
  updatedAt: string;
}

export interface ConfirmedChoice {
  supplier: string;
  price: number;
  date: string;
}

export interface AppState {
  uploads: Upload[];
  heldPrices: Upload[];
  catalog: CatalogItem[];
  mappers: Record<string, ColumnMapper>;
  matches: Record<string, MatchDecision>;
  productMemory: Record<string, ProductMemory>;
  reviewPasses: Record<string, boolean>;
  confirmed: Record<string, ConfirmedChoice>;
  absent: Record<string, string>;
  cleared: Record<string, boolean>;
  seen: Record<string, number>;
  seenReady: boolean;
  suppliers: SupplierCard[];
  notInPrice: Record<string, NotInPriceItem[]>;
  priceHistory: Record<string, PricePoint[]>;
  draftOrders: DraftOrder[];
  priceWatch: PriceWatch[];
}

export interface DisplayRow {
  key: string;
  supplierId: string;
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
