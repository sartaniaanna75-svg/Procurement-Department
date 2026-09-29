import type { AppState, CatalogItem, DisplayRow, MatchDecision, ProductMemory } from "../types";
import { catalogConflict, passKey, recallProduct, saveKnownMatch, traitsFromRow, type Recall } from "./productMemory";
import { listRows } from "./rows";
import { normCode } from "./text";
import { unitsConflict } from "./units";

export const MATCH_LOGIC = 6;

/** Веса признаков. Процент считается только по тем, которые удалось сравнить. */
export const MATCH_WEIGHTS = {
  barcode: 60,
  name: 40,
  brand: 8,
  measure: 12,
  pack: 5,
  unit: 4,
  supplierCode: 4,
};

function barcodeDigits(value: string): string {
  const cleaned = value.replace(/[\s.\-–—]/g, "");
  if (!/^\d+$/.test(cleaned)) return "";
  return cleaned.length === 8 || cleaned.length === 12 || cleaned.length === 13 || cleaned.length === 14 ? cleaned : "";
}

const STOP_WORDS = new Set([
  "и", "или", "в", "во", "на", "по", "для", "с", "со", "к", "ко", "от", "из", "у", "о", "об", "обо",
  "а", "но", "не", "да", "же", "ли", "бы", "the", "and", "or", "of", "for", "to", "a", "an", "in", "on", "with",
]);

export interface CatalogIndex {
  items: CatalogItem[];
  byCode: Map<string, CatalogItem[]>;
  byBarcode: Map<string, CatalogItem[]>;
  tokenToIds: Map<string, number[]>;
  frequency: Map<string, number>;
  expanded: Array<Set<string>>;
}

const UNIT_WORDS = new Set(["мл", "ml", "кг", "kg", "гр", "gr", "г", "g", "л", "l", "шт", "штук", "уп", "упак", "pcs"]);

function stemToken(token: string): string {
  let value = token;
  const endings = ["ями", "ами", "ого", "ему", "ыми", "ими", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю", "ах", "ях", "ов", "ев", "ам", "ям", "ом", "ем"];
  for (const ending of endings) {
    if (value.length - ending.length >= 4 && value.endsWith(ending)) {
      value = value.slice(0, -ending.length);
      break;
    }
  }
  if (value.length >= 5 && /[аяыиеоую]$/.test(value)) value = value.slice(0, -1);
  return value;
}

function contentStems(value: string): string[] {
  const prepared = value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/д\s*\/\s*/g, "для ")
    .replace(/ср\s*[-\/]\s*во/g, "средство ")
    .replace(/ват\./g, "ватные ")
    .replace(/т\.(?=[a-zа-я])/g, "туалетный ")
    .replace(/(\d+(?:[.,]\d+)?)(?=(?:мл|ml|кг|kg|гр|gr|шт|л|l|г|g)\b)/gi, "$1 ");
  const tokens = prepared
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !STOP_WORDS.has(token) && !UNIT_WORDS.has(token));
  return [...new Set(tokens.map(stemToken))];
}

function preferUnit(items: CatalogItem[], unit: string): CatalogItem | null {
  if (items.length === 0) return null;
  return items.find((item) => !unitsConflict(unit, item.unit)) ?? items[0];
}

export function buildCatalogIndex(catalog: CatalogItem[]): CatalogIndex {
  const byCode = new Map<string, CatalogItem[]>();
  const byBarcode = new Map<string, CatalogItem[]>();
  const tokenToIds = new Map<string, number[]>();
  const expanded: Array<Set<string>> = [];

  catalog.forEach((item, index) => {
    const bag = new Set(contentStems(item.name));
    expanded.push(bag);
    for (const token of bag) {
      if (token.length < 2) continue;
      const list = tokenToIds.get(token) ?? [];
      list.push(index);
      tokenToIds.set(token, list);
    }
    const codeKey = normCode(item.code);
    if (codeKey) {
      const list = byCode.get(codeKey) ?? [];
      list.push(item);
      byCode.set(codeKey, list);
    }
    for (const value of [item.code, item.barcode ?? ""]) {
      const digits = barcodeDigits(value);
      if (!digits) continue;
      const list = byBarcode.get(digits) ?? [];
      if (!list.some((other) => other.code === item.code)) list.push(item);
      byBarcode.set(digits, list);
    }
  });

  const frequency = new Map<string, number>();
  for (const [token, ids] of tokenToIds) frequency.set(token, ids.length);
  return { items: catalog, byCode, byBarcode, tokenToIds, frequency, expanded };
}

function lookupBarcode(index: CatalogIndex, barcode: string, unit: string, exclude?: string): CatalogItem | null {
  const digits = barcodeDigits(barcode);
  const key = digits ? normCode(digits) : "";
  const fromCode = key ? (index.byCode.get(key) ?? []) : [];
  const fromDigits = digits ? (index.byBarcode.get(digits) ?? []) : [];
  const merged = [...fromCode, ...fromDigits].filter((item, itemIndex, list) => {
    return item.code !== exclude && list.findIndex((other) => other.code === item.code) === itemIndex;
  });
  return preferUnit(merged, unit);
}

function nameRatio(leftName: string, rightName: string, frequency?: Map<string, number>): number {
  const left = contentStems(leftName);
  const right = new Set(contentStems(rightName));
  if (left.length === 0 || right.size === 0) return 0;
  let hitWeight = 0;
  let total = 0;
  for (const stem of left) {
    const freq = frequency?.get(stem) ?? 0;
    if (frequency && freq === 0) continue;
    const weight = 1 / Math.log2(2 + Math.max(freq, 1));
    total += weight;
    if (right.has(stem)) hitWeight += weight;
    else if (freq > 0 && freq <= 40) total += weight;
  }
  if (total === 0) return 0;
  return Math.max(0, Math.min(1, hitWeight / total));
}

function sameBrands(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const bag = new Set(right);
  return left.some((token) => bag.has(token));
}

function measuresAgree(leftMl: number, leftG: number, rightMl: number, rightG: number): boolean {
  if (leftMl > 0 && rightMl > 0 && leftMl !== rightMl) return false;
  if (leftG > 0 && rightG > 0 && leftG !== rightG) return false;
  if (leftMl > 0 && leftG === 0 && rightG > 0 && rightMl === 0) return false;
  if (rightMl > 0 && rightG === 0 && leftG > 0 && leftMl === 0) return false;
  return leftMl > 0 || leftG > 0;
}

function pieceCount(text: string): number {
  const matched = text.toLowerCase().replace(/ё/g, "е").match(/(\d+)\s*шт/);
  return matched ? Number(matched[1]) : 0;
}

/** Процент только из признаков, которые реально удалось сравнить. 0 — оценки нет. */
function scoreProposal(row: DisplayRow, item: CatalogItem, frequency?: Map<string, number>): { confidence: number; reason: string } {
  const itemBarcode = barcodeDigits(item.barcode || "") || barcodeDigits(item.code);
  const rowBarcode = barcodeDigits(row.barcode);
  const bothBarcodes = Boolean(rowBarcode && itemBarcode);
  const barcodeMatch = bothBarcodes && rowBarcode === itemBarcode;
  if (bothBarcodes && !barcodeMatch) return { confidence: 0, reason: "" };
  const conflict = barcodeMatch ? catalogConflict(row, item.name) : "";
  const ratio = nameRatio(row.name, item.name, frequency);
  const left = traitsFromRow(row);
  const right = traitsFromRow({ ...row, name: item.name, barcode: itemBarcode, volume: "", pack: "" });
  let possible = 0;
  let earned = 0;
  const nameHit = ratio >= 0.45;
  const bothMeasures = (left.ml > 0 || left.g > 0) && (right.ml > 0 || right.g > 0);
  const sizeHit = bothMeasures && measuresAgree(left.ml, left.g, right.ml, right.g);
  const brandHit = sameBrands(left.brands, right.brands);
  const leftPack = pieceCount(`${row.name} ${row.pack}`);
  const rightPack = pieceCount(item.name);
  const bothPacks = leftPack > 0 && rightPack > 0;

  if (bothBarcodes) {
    possible += MATCH_WEIGHTS.barcode;
    if (barcodeMatch && !conflict) earned += MATCH_WEIGHTS.barcode;
    else if (barcodeMatch && conflict) earned += Math.round(MATCH_WEIGHTS.barcode * 0.4);
  }
  possible += MATCH_WEIGHTS.name;
  earned += Math.round(MATCH_WEIGHTS.name * ratio);
  if (left.brands.length > 0 && right.brands.length > 0) {
    possible += MATCH_WEIGHTS.brand;
    if (brandHit) earned += MATCH_WEIGHTS.brand;
  }
  if (bothMeasures) {
    possible += MATCH_WEIGHTS.measure;
    if (sizeHit) earned += MATCH_WEIGHTS.measure;
  }
  if (bothPacks) {
    possible += MATCH_WEIGHTS.pack;
    if (leftPack === rightPack) earned += MATCH_WEIGHTS.pack;
  }
  if (row.unit.trim() && item.unit.trim()) {
    possible += MATCH_WEIGHTS.unit;
    if (!unitsConflict(row.unit, item.unit)) earned += MATCH_WEIGHTS.unit;
  }
  const codeHit = Boolean(row.supplierCode && row.supplierCode === item.code && (barcodeMatch || nameHit));
  if (codeHit) {
    possible += MATCH_WEIGHTS.supplierCode;
    earned += MATCH_WEIGHTS.supplierCode;
  }
  if (possible === 0 || earned <= 0) return { confidence: 0, reason: "" };
  const confidence = Math.max(1, Math.min(100, Math.round((earned / possible) * 100)));
  let reason = "Частичное совпадение признаков";
  if (conflict) reason = conflict;
  else if (barcodeMatch && nameHit) reason = "Точный штрихкод + название";
  else if (barcodeMatch) reason = "Точный штрихкод";
  else if (nameHit && brandHit && sizeHit) reason = "Похожее название + бренд + фасовка";
  else if (nameHit && sizeHit) reason = "Похожее название + одинаковый объём";
  else if (nameHit && brandHit) reason = "Похожее название + бренд + фасовка";
  else if (nameHit) reason = "Похожее название";
  return { confidence, reason };
}

function sharedStemCount(stems: string[], bag: Set<string>): number {
  let hits = 0;
  for (const stem of stems) if (bag.has(stem)) hits += 1;
  return hits;
}

function candidateIds(stems: string[], index: CatalogIndex): number[] {
  const scores = new Map<number, number>();
  const known = stems
    .map((stem) => ({ list: index.tokenToIds.get(stem) ?? [] }))
    .filter((item) => item.list.length > 0 && item.list.length <= 500)
    .sort((left, right) => left.list.length - right.list.length)
    .slice(0, 5);
  for (const item of known) {
    const weight = 1 / Math.log2(2 + item.list.length);
    for (const id of item.list) scores.set(id, (scores.get(id) ?? 0) + weight);
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 40)
    .map((entry) => entry[0]);
}

export function suggestMatch(row: DisplayRow, index: CatalogIndex, excludeCode?: string): MatchDecision {
  const empty: MatchDecision = { status: "need", code: "", confidence: 0, reason: "", relation: "exact" };
  if (index.items.length === 0) return empty;

  const byBarcode = lookupBarcode(index, row.barcode, row.unit, excludeCode);
  if (byBarcode) {
    const scored = scoreProposal(row, byBarcode, index.frequency);
    const conflict = catalogConflict(row, byBarcode.name);
    const reason = conflict
      ? `${conflict}. В каталоге: «${byBarcode.name}».`
      : unitsConflict(row.unit, byBarcode.unit)
        ? "Точный штрихкод, единица не совпала"
        : scored.reason || "Точный штрихкод";
    return { status: "review", code: byBarcode.code, confidence: scored.confidence, reason, relation: "exact" };
  }

  const stems = contentStems(row.name);
  const ranked: Array<{ item: CatalogItem; confidence: number; reason: string }> = [];
  for (const id of candidateIds(stems, index)) {
    const item = index.items[id];
    if (!item || item.code === excludeCode) continue;
    if (sharedStemCount(stems, index.expanded[id] ?? new Set()) < 2) continue;
    const scored = scoreProposal(row, item, index.frequency);
    if (scored.confidence < 40) continue;
    ranked.push({ item, confidence: scored.confidence, reason: scored.reason });
  }
  ranked.sort((left, right) => right.confidence - left.confidence);
  const best = ranked[0];
  if (!best) return empty;
  const second = ranked[1];
  const ambiguous = Boolean(second && best.confidence - second.confidence < 8 && second.confidence >= 45);
  const status = ambiguous || best.confidence < 62 ? "review" : "need";
  const reason = ambiguous ? "Несколько возможных совпадений" : best.reason;
  const decision: MatchDecision = { status, code: best.item.code, confidence: best.confidence, reason, relation: "exact" };
  if (!unitsConflict(row.unit, best.item.unit)) return decision;
  return { ...decision, reason: decision.reason.includes("единица") ? decision.reason : `${decision.reason}, единица не совпала` };
}

function memoryBuckets(memory: AppState["productMemory"]): Map<string, ProductMemory[]> {
  const buckets = new Map<string, ProductMemory[]>();
  for (const item of Object.values(memory)) pushMemory(buckets, item);
  return buckets;
}

function pushMemory(buckets: Map<string, ProductMemory[]>, item: ProductMemory): void {
  const keys = [item.supplierId, item.supplier.trim().toLowerCase()].filter(Boolean);
  for (const key of keys) {
    const list = buckets.get(key) ?? [];
    const index = list.findIndex((other) => other.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
    buckets.set(key, list);
  }
}

function bucketFor(buckets: Map<string, ProductMemory[]>, row: DisplayRow): ProductMemory[] | undefined {
  return buckets.get(row.supplierId) ?? buckets.get(row.supplier.trim().toLowerCase());
}

export function applyAutoMatch(state: AppState, options?: { reconsiderAbsent?: boolean }): AppState {
  const rows = listRows(state.uploads);
  const index = buildCatalogIndex(state.catalog);
  const codes = new Set(state.catalog.map((item) => item.code));
  const matches: Record<string, MatchDecision> = { ...state.matches };
  let productMemory = state.productMemory;
  let buckets = memoryBuckets(productMemory);
  const remember = (rowKey: string, decision: MatchDecision) => {
    const saved = saveKnownMatch({ ...state, productMemory, matches }, rowKey, decision);
    for (const item of Object.values(saved.productMemory)) {
      if (productMemory[item.id] !== item) pushMemory(buckets, item);
    }
    productMemory = saved.productMemory;
    matches[rowKey] = saved.matches[rowKey] ?? decision;
  };
  for (const row of rows) {
    const bucket = bucketFor(buckets, row);
    const previous = state.matches[row.key];
    const recalled = recallProduct(productMemory, row, state.reviewPasses, bucket);
    const barred = barcodeReview(row, index, recalled);
    if (barred) {
      matches[row.key] = barred;
      continue;
    }
    if (recalled.kind === "review") {
      matches[row.key] = decisionFromRecall(recalled);
      continue;
    }
    if (previous && (previous.status === "confirmed" || previous.status === "picked") && codes.has(previous.code) && recalled.kind !== "rejected") {
      matches[row.key] = previous;
      if (recalled.kind === "none") remember(row.key, previous);
      continue;
    }
    if (recalled.kind === "rejected") {
      matches[row.key] = { status: "rejected", code: "", confidence: recalled.confidence, reason: recalled.reason, relation: "exact" };
      continue;
    }
    if (recalled.kind === "alternative") {
      matches[row.key] = { status: "review", code: recalled.code, confidence: recalled.confidence, reason: recalled.reason, relation: "alternative" };
      continue;
    }
    if (recalled.kind === "absent") {
      const fresh = options?.reconsiderAbsent ? suggestMatch(row, index) : null;
      matches[row.key] = fresh?.code
        ? { status: "review", code: fresh.code, confidence: fresh.confidence, reason: "Раньше товара не было в каталоге. Сейчас найдено возможное соответствие.", relation: "exact" }
        : { status: "missing", code: "", confidence: 0, reason: "нет в каталоге", relation: "exact" };
      continue;
    }
    if (recalled.kind === "matched" && (codes.size === 0 || codes.has(recalled.code))) {
      matches[row.key] = {
        status: recalled.matchStatus === "picked" ? "picked" : "confirmed",
        code: recalled.code,
        confidence: recalled.confidence,
        reason: recalled.reason,
        relation: "exact",
      };
      continue;
    }
    if (previous?.status === "skipped" && recalled.kind === "none") {
      matches[row.key] = previous;
      continue;
    }
    if (previous?.status === "missing" && recalled.kind === "none") {
      matches[row.key] = previous;
      continue;
    }
    matches[row.key] = suggestMatch(row, index);
  }
  return { ...state, matches, productMemory, seenReady: true, matchLogic: MATCH_LOGIC };
}

function barcodeReview(row: DisplayRow, index: CatalogIndex, recalled: Recall): MatchDecision | null {
  const hit = lookupBarcode(index, row.barcode, row.unit);
  if (!hit) return null;
  const conflict = catalogConflict(row, hit.name);
  const linked = recalled.kind === "matched" || recalled.kind === "alternative" ? recalled.code : "";
  const elsewhere = Boolean(linked && linked !== hit.code);
  if (!conflict && !elsewhere) return null;
  const prior =
    recalled.kind === "matched" && recalled.code
      ? ` Раньше сопоставлено с ${recalled.code}. Сейчас: «${row.name}».`
      : recalled.kind !== "none"
        ? ` Раньше: ${recalled.reason || "было другое решение"}. Сейчас: «${row.name}».`
        : "";
  const reason = conflict
    ? `${conflict}. В каталоге: «${hit.name}».${prior}`
    : `Штрихкод совпадает, но название и характеристики товара существенно отличаются. В каталоге: «${hit.name}».${prior}`;
  return { status: "review", code: hit.code, confidence: scoreProposal(row, hit).confidence, reason, relation: "exact" };
}

function decisionFromRecall(recalled: Recall): MatchDecision {
  return { status: "review", code: recalled.code, confidence: recalled.confidence, reason: recalled.reason, relation: "exact" };
}

const OPEN_STATUS = new Set<MatchDecision["status"]>(["need", "review", "skipped"]);

export function skipMatches(state: AppState, keys: string[]): AppState {
  const matches = { ...state.matches };
  for (const key of keys) {
    const current = matches[key] ?? { status: "need" as const, code: "", confidence: 0, reason: "", relation: "exact" as const };
    if (!OPEN_STATUS.has(current.status)) continue;
    matches[key] = { ...current, status: "skipped" };
  }
  return { ...state, matches };
}

export function reopenSkipped(state: AppState, key: string): AppState {
  const row = listRows(state.uploads).find((item) => item.key === key);
  if (!row) return state;
  return { ...state, matches: { ...state.matches, [key]: suggestMatch(row, buildCatalogIndex(state.catalog)) } };
}

export function dismissReview(state: AppState, key: string): AppState {
  const row = listRows(state.uploads).find((item) => item.key === key);
  if (!row) return state;
  return applyAutoMatch({
    ...state,
    reviewPasses: { ...state.reviewPasses, [passKey(row)]: true },
  });
}
