import type {
  AppState,
  ColumnMapper,
  DisplayRow,
  DraftOrder,
  IsoWeekday,
  NotInPriceItem,
  PricePoint,
  PriceTuple,
  PriceWatch,
  SupplierCard,
  SupplierSchedule,
  Upload,
} from "../types";
import { applyAutoMatch } from "./matching";
import { rememberedInBoth } from "./productMemory";
import { matchKey, toRow } from "./rows";
import { rememberSignals, type SupplierSignals } from "./suppliers";
import { supplierKey } from "./text";

/**
 * Календарь закупок и актуальный прайс.
 * Будущий почтовый агент вызывает эти же функции, а не отдельную копию правил.
 */

export interface AcceptedPrice {
  supplierId: string;
  fileName: string;
  receivedAt: string;
  rows: PriceTuple[];
  mapper: ColumnMapper;
  signals?: SupplierSignals;
}

export interface AcceptResult {
  state: AppState;
  ok: boolean;
  reason: string;
  cycleDate: string;
}

export interface CycleStatus {
  supplierId: string;
  name: string;
  responsible: string;
  cycleDate: string;
  receivedAt: string;
  ready: boolean;
  level: "ready" | "waiting" | "attention" | "critical";
  text: string;
  oneCReady: boolean;
  watch: string;
}

export function isoWeekday(date: Date): IsoWeekday {
  const day = date.getDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export function dateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDay(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  if (!day || !month) return isoDate;
  return `${day}.${month}`;
}

export function parseDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
}

function atTime(day: Date, time: string): Date {
  const next = new Date(day);
  const matched = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!matched) {
    next.setHours(23, 59, 0, 0);
    return next;
  }
  next.setHours(Number(matched[1]), Number(matched[2]), 0, 0);
  return next;
}

/** Ближайший день заказа, для которого ещё не прошёл крайний срок получения. */
export function orderCycleDate(orderDays: IsoWeekday[], receivedAt: Date, schedule: SupplierSchedule): string {
  if (orderDays.length === 0) return "";
  const start = new Date(receivedAt);
  start.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 21; offset += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    if (!orderDays.includes(isoWeekday(day))) continue;
    const deadline = cycleDeadline(dateISO(day), schedule);
    if (receivedAt.getTime() <= deadline.getTime()) return dateISO(day);
  }
  return "";
}

export function cycleDeadline(cycleDate: string, schedule: SupplierSchedule): Date {
  const order = parseDay(cycleDate);
  if (schedule.deadlineWeekday == null) return atTime(order, schedule.deadlineTime);
  const back = (isoWeekday(order) - schedule.deadlineWeekday + 7) % 7;
  const day = new Date(order);
  day.setDate(order.getDate() - back);
  return atTime(day, schedule.deadlineTime);
}

export function nextOrderDate(orderDays: IsoWeekday[], from: Date, schedule: SupplierSchedule): string {
  return orderCycleDate(orderDays, from, schedule);
}

function priceCovers(upload: Upload, cycleDate: string, schedule: SupplierSchedule): boolean {
  if (!cycleDate || upload.cycleDate !== cycleDate) return false;
  if (schedule.validityDays == null) return true;
  const received = new Date(upload.uploadedAt);
  received.setHours(0, 0, 0, 0);
  const age = (parseDay(cycleDate).getTime() - received.getTime()) / 86400000;
  return age <= schedule.validityDays;
}

function currentUpload(state: AppState, supplierId: string): Upload | undefined {
  return state.uploads.find((upload) => upload.supplierId === supplierId);
}

export function acceptCurrentPrice(state: AppState, input: AcceptedPrice): AcceptResult {
  const card = state.suppliers.find((item) => item.id === input.supplierId);
  if (!card) return { state, ok: false, reason: "Поставщик не найден.", cycleDate: "" };
  const rows = input.rows.filter((tuple) => String(tuple[1] ?? "").trim() && Number(tuple[2]) > 0);
  if (rows.length === 0) {
    return { state, ok: false, reason: "Новый прайс не обработан. Текущий прайс оставлен без изменений.", cycleDate: "" };
  }

  const receivedAt = input.receivedAt || new Date().toISOString();
  const cycleDate = orderCycleDate(card.orderDays, new Date(receivedAt), card.schedule);
  const versionId = `ver-${crypto.randomUUID()}`;
  const stamped = rows.map((tuple) => withSupplier(tuple, card.name));
  const upload: Upload = {
    file: input.fileName,
    supplier: card.name,
    supplierId: card.id,
    uploadedAt: receivedAt,
    cycleDate,
    versionId,
    rows: stamped,
  };

  const previous = currentUpload(state, card.id);
  const nextRows = stamped.map((tuple) => toRow(tuple));
  const nextKeys = new Set(nextRows.map((row) => row.key));
  const notInPrice = { ...state.notInPrice };
  const kept = (notInPrice[card.id] ?? []).filter((item) => {
    if (nextKeys.has(itemKey(card.name, item))) return false;
    const stored = toRow([card.name, item.name, item.lastPrice, item.barcode, item.code, item.unit, "", "", "", "", "", ""]);
    return !rememberedInBoth(state.productMemory, stored, nextRows);
  });
  const disappeared = previous ? missingItems(card.id, previous, nextKeys, state.productMemory, nextRows) : [];
  notInPrice[card.id] = [...kept, ...disappeared.filter((item) => !kept.some((other) => itemKey(card.name, other) === itemKey(card.name, item)))];

  const priceHistory = appendHistory(state, card.name, previous, stamped, versionId, receivedAt);
  const drafts = state.draftOrders.filter((draft) => draft.supplierId === card.id && draft.cycleDate === cycleDate && draft.priceVersionId !== versionId);
  const priceWatch = previous ? watchesFor(state.priceWatch, drafts, previous.versionId, versionId, receivedAt, card.id, cycleDate) : state.priceWatch;
  const heldPrices = holdPrevious(state, previous, drafts);

  const seen = { ...state.seen };
  for (const tuple of stamped) {
    const row = toRow(tuple);
    seen[row.key] = (seen[row.key] ?? 0) + 1;
  }

  const structure = input.mapper.headerSignature.map((cell) => cell.trim().toLowerCase().replace(/ё/g, "е")).filter(Boolean).join("|");
  const suppliers = state.suppliers.map((item) =>
    item.id === card.id ? rememberSignals({ ...item, structureHint: structure || item.structureHint }, input.signals ?? emptySignals(), structure) : item,
  );

  const replaced: AppState = {
    ...state,
    suppliers,
    uploads: [...state.uploads.filter((item) => item.supplierId !== card.id), upload],
    heldPrices,
    notInPrice,
    priceHistory,
    priceWatch,
    seen,
    mappers: { ...state.mappers, [supplierKey(card.name)]: input.mapper },
  };
  return {
    state: applyAutoMatch(replaced),
    ok: true,
    reason: cycleText(receivedAt, cycleDate),
    cycleDate,
  };
}

function emptySignals(): SupplierSignals {
  return { fileName: "", email: "", companyNames: [], inns: [], sheetNames: [], structureHint: "" };
}

function withSupplier(tuple: PriceTuple, name: string): PriceTuple {
  return [name, tuple[1], tuple[2], tuple[3], tuple[4], tuple[5], tuple[6], tuple[7], tuple[8], tuple[9], tuple[10], tuple[11]];
}

function itemKey(supplier: string, item: NotInPriceItem): string {
  return matchKey(supplier, item.name, item.code, item.barcode, item.unit);
}

function missingItems(
  supplierId: string,
  previous: Upload,
  nextKeys: Set<string>,
  memory: AppState["productMemory"],
  nextRows: DisplayRow[],
): NotInPriceItem[] {
  const items: NotInPriceItem[] = [];
  const seen = new Set<string>();
  for (const tuple of previous.rows) {
    const row = toRow(tuple);
    if (nextKeys.has(row.key) || seen.has(row.key) || rememberedInBoth(memory, row, nextRows)) continue;
    seen.add(row.key);
    items.push({
      supplierId,
      name: row.name,
      barcode: row.barcode,
      code: row.code,
      unit: row.unit,
      lastPrice: row.price,
      lastSeenAt: previous.uploadedAt,
    });
  }
  return items;
}

function appendHistory(state: AppState, supplier: string, previous: Upload | undefined, rows: PriceTuple[], versionId: string, at: string): Record<string, PricePoint[]> {
  const history = { ...state.priceHistory };
  const previousPrice = new Map<string, number>();
  for (const tuple of previous?.rows ?? []) {
    const row = toRow(withSupplier(tuple, supplier));
    previousPrice.set(row.key, row.price);
  }
  for (const tuple of rows) {
    const row = toRow(tuple);
    const match = state.matches[row.key];
    if (!match || (match.status !== "confirmed" && match.status !== "picked")) continue;
    const points = history[row.key] ? [...history[row.key]] : [];
    const last = points[points.length - 1];
    const prior = previousPrice.get(row.key);
    if (prior !== undefined && prior !== row.price && (!last || last.price !== prior)) {
      points.push({ at: previous?.uploadedAt || at, price: prior, versionId: previous?.versionId || versionId });
    }
    if (!last || last.price !== row.price) points.push({ at, price: row.price, versionId });
    history[row.key] = points.slice(-24);
  }
  return history;
}

function watchesFor(current: PriceWatch[], drafts: DraftOrder[], previousVersionId: string, nextVersionId: string, receivedAt: string, supplierId: string, cycleDate: string): PriceWatch[] {
  if (drafts.length === 0) return current;
  const added = drafts.map((draft) => ({
    supplierId,
    cycleDate,
    draftId: draft.id,
    previousVersionId,
    nextVersionId,
    receivedAt,
  }));
  return [...current, ...added];
}

function holdPrevious(state: AppState, previous: Upload | undefined, drafts: DraftOrder[]): Upload[] {
  const referenced = new Set(state.draftOrders.map((draft) => draft.priceVersionId));
  for (const draft of drafts) referenced.add(draft.priceVersionId);
  let held = state.heldPrices.filter((upload) => referenced.has(upload.versionId));
  if (previous && drafts.some((draft) => draft.priceVersionId === previous.versionId) && !held.some((upload) => upload.versionId === previous.versionId)) {
    held = [...held, previous];
  }
  return held;
}

export function cycleText(receivedAt: string, cycleDate: string): string {
  const received = formatDay(dateISO(new Date(receivedAt)));
  if (!cycleDate) return `Прайс получен ${received}. Дни заказа у поставщика не заданы.`;
  return `Прайс получен ${received}. Для заказа ${formatDay(cycleDate)}. Готов к заказу.`;
}

export function procurementBoard(state: AppState, now = new Date()): { today: CycleStatus[]; tomorrow: CycleStatus[]; later: CycleStatus[] } {
  const today = dateISO(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(now.getDate() + 1);
  const tomorrow = dateISO(tomorrowDate);
  const todayItems: CycleStatus[] = [];
  const tomorrowItems: CycleStatus[] = [];
  const laterItems: CycleStatus[] = [];
  for (const card of state.suppliers) {
    if (!card.active || card.orderDays.length === 0) continue;
    if (card.orderDays.includes(isoWeekday(now))) todayItems.push(statusFor(state, card, today, now));
    if (card.orderDays.includes(isoWeekday(tomorrowDate))) tomorrowItems.push(statusFor(state, card, tomorrow, now));
    const upcoming = orderCycleDate(card.orderDays, now, card.schedule);
    if (upcoming && upcoming !== today && upcoming !== tomorrow) laterItems.push(statusFor(state, card, upcoming, now));
  }
  const byName = (a: CycleStatus, b: CycleStatus) => a.name.localeCompare(b.name, "ru");
  return { today: todayItems.sort(byName), tomorrow: tomorrowItems.sort(byName), later: laterItems.sort(byName) };
}

function statusFor(state: AppState, card: SupplierCard, cycleDate: string, now: Date): CycleStatus {
  const upload = state.uploads.find((item) => item.supplierId === card.id && priceCovers(item, cycleDate, card.schedule));
  const watch = state.priceWatch.find((item) => item.supplierId === card.id && item.cycleDate === cycleDate);
  const oneC = [card.oneC.guid, card.oneC.partnerGuid, card.oneC.counterpartyGuid, card.oneC.agreementGuid, card.oneC.contractGuid, card.oneC.organizationGuid].every((value) => value.trim());
  if (upload) {
    return {
      supplierId: card.id,
      name: card.name,
      responsible: card.responsible,
      cycleDate,
      receivedAt: upload.uploadedAt,
      ready: true,
      level: "ready",
      text: cycleText(upload.uploadedAt, cycleDate),
      oneCReady: oneC,
      watch: watch ? "После формирования заказа получен новый прайс." : "",
    };
  }
  const deadline = cycleDeadline(cycleDate, card.schedule);
  const critical = now.getTime() >= deadline.getTime();
  const attention = critical || now.getTime() >= warningStart(cycleDate, card, deadline).getTime();
  return {
    supplierId: card.id,
    name: card.name,
    responsible: card.responsible,
    cycleDate,
    receivedAt: "",
    ready: false,
    level: critical ? "critical" : attention ? "attention" : "waiting",
    text: critical
      ? "Прайс не получен. Заказ требует внимания."
      : attention
        ? `Нет актуального прайса от поставщика ${card.name} для заказа ${formatDay(cycleDate)}.`
        : "Прайс ещё не получен.",
    oneCReady: oneC,
    watch: "",
  };
}

function warningStart(cycleDate: string, card: SupplierCard, deadline: Date): Date {
  const hours = card.schedule.reminders.reduce((max, stage) => Math.max(max, stage.hoursBeforeDeadline), 0);
  let start = new Date(deadline.getTime() - hours * 3600000);
  const orderStart = parseDay(cycleDate);
  if (hours === 0 && start.getTime() > orderStart.getTime()) start = orderStart;
  if (card.schedule.expectFrom != null) {
    const back = (isoWeekday(parseDay(cycleDate)) - card.schedule.expectFrom + 7) % 7;
    const expect = parseDay(cycleDate);
    expect.setDate(expect.getDate() - back);
    if (expect.getTime() < start.getTime()) start = expect;
  }
  return start;
}

export function upsertSupplier(state: AppState, card: SupplierCard): AppState {
  const name = card.name.trim();
  if (!name) return state;
  const existing = state.suppliers.find((item) => item.id === card.id);
  const nextCard: SupplierCard = {
    ...card,
    name,
    orderDays: uniqueDays(card.orderDays),
    aliases: cleanList(card.aliases),
    emails: cleanList(card.emails).map((email) => email.toLowerCase()),
    inns: cleanList(card.inns),
    fileHints: cleanList(card.fileHints),
    sheetHints: cleanList(card.sheetHints),
  };
  if (!existing) return { ...state, suppliers: [...state.suppliers, nextCard] };
  const renamed = existing.name === name ? state : renameSupplier(state, existing.name, name);
  return { ...renamed, suppliers: renamed.suppliers.map((item) => (item.id === card.id ? nextCard : item)) };
}

function uniqueDays(days: IsoWeekday[]): IsoWeekday[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function renameSupplier(state: AppState, fromName: string, toName: string): AppState {
  const from = fromName.trim();
  const to = toName.trim();
  if (!from || !to) return state;
  const renameMemory = (memory: AppState["productMemory"]): AppState["productMemory"] => {
    const next: AppState["productMemory"] = {};
    for (const [id, item] of Object.entries(memory)) {
      next[id] = supplierKey(item.supplier) === supplierKey(from) ? { ...item, supplier: to } : item;
    }
    return next;
  };
  if (supplierKey(from) === supplierKey(to)) {
    const retitle = (upload: Upload): Upload =>
      supplierKey(upload.supplier) === supplierKey(from) ? { ...upload, supplier: to, rows: upload.rows.map((tuple) => withSupplier(tuple, to)) } : upload;
    return {
      ...state,
      suppliers: state.suppliers.map((card) => (supplierKey(card.name) === supplierKey(from) ? { ...card, name: to } : card)),
      uploads: state.uploads.map(retitle),
      heldPrices: state.heldPrices.map(retitle),
      productMemory: renameMemory(state.productMemory),
    };
  }
  const rewrite = (key: string) => {
    const parts = key.split("\u001f");
    if (parts[0] !== supplierKey(from)) return key;
    parts[0] = supplierKey(to);
    return parts.join("\u001f");
  };
  const matches: AppState["matches"] = {};
  for (const [key, value] of Object.entries(state.matches)) matches[rewrite(key)] = value;
  const priceHistory: AppState["priceHistory"] = {};
  for (const [key, value] of Object.entries(state.priceHistory)) priceHistory[rewrite(key)] = value;
  const seen: AppState["seen"] = {};
  for (const [key, value] of Object.entries(state.seen)) seen[rewrite(key)] = value;
  const cleared: AppState["cleared"] = {};
  for (const [key, value] of Object.entries(state.cleared)) cleared[rewrite(key)] = value;
  const absent: AppState["absent"] = {};
  for (const [key, value] of Object.entries(state.absent)) {
    const [code, supplier] = key.split("|");
    absent[supplierKey(supplier) === supplierKey(from) ? `${code}|${to}` : key] = value;
  }
  const mapUpload = (upload: Upload): Upload =>
    upload.supplierId && state.suppliers.some((card) => card.id === upload.supplierId && supplierKey(card.name) === supplierKey(from))
      ? { ...upload, supplier: to, rows: upload.rows.map((tuple) => withSupplier(tuple, to)) }
      : supplierKey(upload.supplier) === supplierKey(from)
        ? { ...upload, supplier: to, rows: upload.rows.map((tuple) => withSupplier(tuple, to)) }
        : upload;
  const mappers = { ...state.mappers };
  const mapper = mappers[supplierKey(from)];
  if (mapper) {
    delete mappers[supplierKey(from)];
    mappers[supplierKey(to)] = mapper;
  }
  const confirmed: AppState["confirmed"] = {};
  for (const [code, choice] of Object.entries(state.confirmed)) {
    confirmed[code] = supplierKey(choice.supplier) === supplierKey(from) ? { ...choice, supplier: to } : choice;
  }
  return {
    ...state,
    uploads: state.uploads.map(mapUpload),
    heldPrices: state.heldPrices.map(mapUpload),
    suppliers: state.suppliers.map((card) => (supplierKey(card.name) === supplierKey(from) ? { ...card, name: to } : card)),
    matches,
    productMemory: renameMemory(state.productMemory),
    priceHistory,
    seen,
    cleared,
    absent,
    confirmed,
    mappers,
  };
}
