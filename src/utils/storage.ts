import type { AppState, CatalogItem, ColumnMapper, DraftOrder, IsoWeekday, MatchDecision, MatchStatus, NotInPriceItem, OfferSource, OneCLink, PricePoint, PriceTuple, PriceWatch, ProductMemory, ProductTraits, PurchaseMode, ReminderStage, SupplierCard, SupplierSchedule, Upload } from "../types";
import { STORAGE_KEY } from "../types";
import { createSupplier, emptyOneC, emptySchedule } from "./suppliers";
import { supplierKey } from "./text";
import { matchKey } from "./rows";

export function emptyState(): AppState {
  return {
    uploads: [],
    heldPrices: [],
    catalog: [],
    mappers: {},
    matches: {},
    productMemory: {},
    reviewPasses: {},
    confirmed: {},
    absent: {},
    cleared: {},
    seen: {},
    seenReady: false,
    suppliers: [],
    notInPrice: {},
    priceHistory: {},
    draftOrders: [],
    priceWatch: [],
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
    String(value[7] ?? ""),
    String(value[8] ?? ""),
    String(value[9] ?? ""),
    String(value[10] ?? ""),
    String(value[11] ?? ""),
  ];
}

function normalizeUpload(value: unknown): Upload | null {
  if (!isPlain(value) || !Array.isArray(value.rows)) return null;
  const supplier = String(value.supplier ?? "");
  return {
    file: String(value.file ?? ""),
    supplier,
    supplierId: String(value.supplierId ?? ""),
    uploadedAt: String(value.uploadedAt ?? ""),
    cycleDate: String(value.cycleDate ?? ""),
    versionId: String(value.versionId ?? ""),
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

function mapperIndex(value: unknown, fallback = -1): number {
  const index = Number(value);
  return Number.isInteger(index) ? index : fallback;
}

function normalizeMapper(value: unknown): ColumnMapper | null {
  if (!isPlain(value)) return null;
  const labels = isPlain(value.labels) ? value.labels : {};
  const mapper: ColumnMapper = {
    headerRow: Number(value.headerRow),
    name: mapperIndex(value.name),
    price: mapperIndex(value.price),
    barcode: mapperIndex(value.barcode),
    code: mapperIndex(value.code),
    unit: mapperIndex(value.unit),
    stock: mapperIndex(value.stock),
    pack: mapperIndex(value.pack),
    multiplicity: mapperIndex(value.multiplicity),
    volume: mapperIndex(value.volume),
    labels: {
      name: String(labels.name ?? ""),
      price: String(labels.price ?? ""),
      barcode: String(labels.barcode ?? ""),
      stock: String(labels.stock ?? ""),
      unit: String(labels.unit ?? ""),
      pack: String(labels.pack ?? ""),
      multiplicity: String(labels.multiplicity ?? ""),
      supplierCode: String(labels.supplierCode ?? ""),
    },
    headerSignature: Array.isArray(value.headerSignature) ? value.headerSignature.map((item) => String(item ?? "")) : [],
  };
  if (!Number.isInteger(mapper.headerRow) || mapper.headerRow < 0) return null;
  return mapper;
}

const STATUSES = new Set<MatchStatus>(["need", "confirmed", "picked", "missing", "rejected", "review"]);

function normalizeMatch(value: unknown): MatchDecision | null {
  if (!isPlain(value) || typeof value.status !== "string" || !STATUSES.has(value.status as MatchStatus)) return null;
  return {
    status: value.status as MatchStatus,
    code: String(value.code ?? ""),
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0,
    reason: String(value.reason ?? ""),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeTraits(value: unknown): ProductTraits | null {
  if (!isPlain(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  const ml = Number(value.ml);
  const g = Number(value.g);
  return {
    barcode: String(value.barcode ?? ""),
    name: value.name.trim(),
    brands: stringList(value.brands),
    kind: String(value.kind ?? ""),
    purpose: String(value.purpose ?? ""),
    variants: stringList(value.variants),
    ml: Number.isFinite(ml) ? ml : 0,
    g: Number.isFinite(g) ? g : 0,
    pack: String(value.pack ?? ""),
    unit: String(value.unit ?? ""),
  };
}

function normalizeMemory(value: unknown): ProductMemory | null {
  if (!isPlain(value) || (value.verdict !== "rejected" && value.verdict !== "matched")) return null;
  const traits = normalizeTraits(value.traits);
  if (!traits) return null;
  const id = String(value.id ?? "").trim();
  const supplier = String(value.supplier ?? "").trim();
  if (!id || !supplier) return null;
  const matchStatus = value.matchStatus === "picked" || value.matchStatus === "confirmed" ? value.matchStatus : "";
  return {
    id,
    supplierId: String(value.supplierId ?? ""),
    supplier,
    verdict: value.verdict,
    catalogCode: String(value.catalogCode ?? ""),
    matchStatus,
    reason: String(value.reason ?? ""),
    traits,
    updatedAt: String(value.updatedAt ?? ""),
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

function weekday(value: unknown): IsoWeekday | null {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 7) return null;
  return day as IsoWeekday;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeOneC(value: unknown): OneCLink {
  const link = emptyOneC();
  if (!isPlain(value)) return link;
  for (const key of Object.keys(link) as Array<keyof OneCLink>) link[key] = String(value[key] ?? "");
  return link;
}

function normalizeSchedule(value: unknown): SupplierSchedule {
  const schedule = emptySchedule();
  if (!isPlain(value)) return schedule;
  schedule.expectFrom = weekday(value.expectFrom);
  schedule.expectTo = weekday(value.expectTo);
  schedule.deadlineWeekday = weekday(value.deadlineWeekday);
  schedule.deadlineTime = String(value.deadlineTime ?? "");
  if (value.validityDays === null || value.validityDays === undefined || value.validityDays === "") {
    schedule.validityDays = null;
  } else {
    const validity = Number(value.validityDays);
    schedule.validityDays = Number.isFinite(validity) && validity >= 0 ? validity : null;
  }
  schedule.reminders = Array.isArray(value.reminders)
    ? value.reminders
        .map((item) => {
          if (!isPlain(item)) return null;
          const hours = Number(item.hoursBeforeDeadline);
          if (!Number.isFinite(hours) || hours < 0) return null;
          const stage: ReminderStage = { id: String(item.id ?? `rem-${hours}`), hoursBeforeDeadline: hours };
          return stage;
        })
        .filter((item): item is ReminderStage => item !== null)
    : [];
  return schedule;
}

function normalizeSupplier(value: unknown): SupplierCard | null {
  if (!isPlain(value)) return null;
  const name = String(value.name ?? "").trim();
  if (!name) return null;
  const base = createSupplier(name, String(value.id ?? "") || `sup-${supplierKey(name)}`);
  return {
    ...base,
    active: value.active !== false,
    fullName: String(value.fullName ?? ""),
    comment: String(value.comment ?? ""),
    responsible: String(value.responsible ?? ""),
    orderDays: textDays(value.orderDays),
    offerSource: offerSourceOf(value.offerSource),
    purchaseMode: purchaseModeOf(value.purchaseMode),
    aliases: textList(value.aliases),
    priceNames: textList(value.priceNames),
    emails: textList(value.emails),
    inns: textList(value.inns),
    fileHints: textList(value.fileHints),
    sheetHints: textList(value.sheetHints),
    structureHint: String(value.structureHint ?? ""),
    oneC: normalizeOneC(value.oneC),
    schedule: normalizeSchedule(value.schedule),
  };
}

function offerSourceOf(value: unknown): OfferSource {
  if (value === "site" || value === "manual" || value === "api" || value === "price") return value;
  return "price";
}

function purchaseModeOf(value: unknown): PurchaseMode {
  if (value === "demand" || value === "manual" || value === "mixed" || value === "schedule") return value;
  return "schedule";
}

function textDays(value: unknown): IsoWeekday[] {
  if (!Array.isArray(value)) return [];
  return value.map(weekday).filter((day): day is IsoWeekday => day !== null);
}

function normalizeNotInPrice(value: unknown): NotInPriceItem | null {
  if (!isPlain(value)) return null;
  const name = String(value.name ?? "").trim();
  if (!name) return null;
  const price = Number(value.lastPrice);
  return {
    supplierId: String(value.supplierId ?? ""),
    name,
    barcode: String(value.barcode ?? ""),
    code: String(value.code ?? ""),
    unit: String(value.unit ?? ""),
    lastPrice: Number.isFinite(price) ? price : 0,
    lastSeenAt: String(value.lastSeenAt ?? ""),
  };
}

function normalizeHistory(value: unknown): PricePoint[] | null {
  if (!Array.isArray(value)) return null;
  const points = value
    .map((item) => {
      if (!isPlain(item)) return null;
      const price = Number(item.price);
      if (!Number.isFinite(price)) return null;
      return { at: String(item.at ?? ""), price, versionId: String(item.versionId ?? "") };
    })
    .filter((item): item is PricePoint => item !== null);
  return points;
}

function normalizeDraft(value: unknown): DraftOrder | null {
  if (!isPlain(value) || value.status !== "draft") return null;
  const supplierId = String(value.supplierId ?? "");
  if (!supplierId) return null;
  return {
    id: String(value.id ?? ""),
    supplierId,
    cycleDate: String(value.cycleDate ?? ""),
    priceVersionId: String(value.priceVersionId ?? ""),
    status: "draft",
    createdAt: String(value.createdAt ?? ""),
  };
}

function normalizeWatch(value: unknown): PriceWatch | null {
  if (!isPlain(value)) return null;
  const supplierId = String(value.supplierId ?? "");
  if (!supplierId) return null;
  return {
    supplierId,
    cycleDate: String(value.cycleDate ?? ""),
    draftId: String(value.draftId ?? ""),
    previousVersionId: String(value.previousVersionId ?? ""),
    nextVersionId: String(value.nextVersionId ?? ""),
    receivedAt: String(value.receivedAt ?? ""),
  };
}

function attachSuppliers(uploads: Upload[], suppliers: SupplierCard[]): { uploads: Upload[]; suppliers: SupplierCard[]; notInPrice: Record<string, NotInPriceItem[]> } {
  const cards = [...suppliers];
  for (const upload of uploads) {
    if (!upload.supplier.trim()) continue;
    if (cards.some((card) => card.id === upload.supplierId || supplierKey(card.name) === supplierKey(upload.supplier))) continue;
    cards.push(createSupplier(upload.supplier, `sup-${supplierKey(upload.supplier)}`));
  }
  const groups = new Map<string, Upload[]>();
  for (const upload of uploads) {
    const card = cards.find((item) => item.id === upload.supplierId || supplierKey(item.name) === supplierKey(upload.supplier));
    if (!card) continue;
    const list = groups.get(card.id) ?? [];
    list.push({ ...upload, supplier: card.name, supplierId: card.id, versionId: upload.versionId || `ver-${upload.uploadedAt || card.id}` });
    groups.set(card.id, list);
  }
  const current: Upload[] = [];
  const notInPrice: Record<string, NotInPriceItem[]> = {};
  for (const [supplierId, list] of groups) {
    const sorted = [...list].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    const latest = sorted[sorted.length - 1];
    current.push(latest);
    const present = new Set(latest.rows.map((tuple) => matchKey(String(tuple[0]), String(tuple[1]), String(tuple[4]), String(tuple[3]), String(tuple[5]))));
    const missing: NotInPriceItem[] = [];
    const seen = new Set<string>();
    for (const older of sorted.slice(0, -1)) {
      for (const tuple of older.rows) {
        const key = matchKey(String(tuple[0]), String(tuple[1]), String(tuple[4]), String(tuple[3]), String(tuple[5]));
        if (present.has(key) || seen.has(key)) continue;
        seen.add(key);
        const price = Number(tuple[2]);
        missing.push({
          supplierId,
          name: String(tuple[1] ?? ""),
          barcode: String(tuple[3] ?? ""),
          code: String(tuple[4] ?? ""),
          unit: String(tuple[5] ?? ""),
          lastPrice: Number.isFinite(price) ? price : 0,
          lastSeenAt: older.uploadedAt,
        });
      }
    }
    if (missing.length > 0) notInPrice[supplierId] = missing;
  }
  return { uploads: current, suppliers: cards, notInPrice };
}

export function normalizeState(value: unknown): AppState {
  const base = emptyState();
  if (!isPlain(value)) return base;
  const suppliers = Array.isArray(value.suppliers)
    ? value.suppliers.map(normalizeSupplier).filter((item): item is SupplierCard => item !== null)
    : [];
  const uploads = Array.isArray(value.uploads)
    ? value.uploads.map(normalizeUpload).filter((upload): upload is Upload => upload !== null)
    : [];
  const attached = attachSuppliers(uploads, suppliers);
  const storedMissing = mapValues(value.notInPrice, (item) => {
    if (!Array.isArray(item)) return null;
    const rows = item.map(normalizeNotInPrice).filter((row): row is NotInPriceItem => row !== null);
    return rows.length > 0 ? rows : null;
  });
  return {
    uploads: attached.uploads,
    heldPrices: Array.isArray(value.heldPrices)
      ? value.heldPrices.map(normalizeUpload).filter((upload): upload is Upload => upload !== null)
      : [],
    catalog: Array.isArray(value.catalog)
      ? value.catalog.map(normalizeCatalogItem).filter((item): item is CatalogItem => item !== null)
      : [],
    mappers: mapValues(value.mappers, normalizeMapper),
    matches: mapValues(value.matches, normalizeMatch),
    productMemory: mapValues(value.productMemory, normalizeMemory),
    reviewPasses: mapValues(value.reviewPasses, (item) => (item === true ? true : null)),
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
    suppliers: attached.suppliers,
    notInPrice: Object.keys(storedMissing).length > 0 ? storedMissing : attached.notInPrice,
    priceHistory: mapValues(value.priceHistory, normalizeHistory),
    draftOrders: Array.isArray(value.draftOrders)
      ? value.draftOrders.map(normalizeDraft).filter((item): item is DraftOrder => item !== null)
      : [],
    priceWatch: Array.isArray(value.priceWatch)
      ? value.priceWatch.map(normalizeWatch).filter((item): item is PriceWatch => item !== null)
      : [],
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
