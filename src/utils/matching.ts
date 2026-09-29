import type { AppState, CatalogItem, DisplayRow, MatchDecision, ProductMemory } from "../types";
import { catalogConflict, passKey, recallProduct, saveKnownMatch, type Recall } from "./productMemory";
import { listRows } from "./rows";
import { normCode } from "./text";
import { unitsConflict } from "./units";

export const MATCH_LOGIC = 2;

function barcodeDigits(value: string): string {
  if (/[^\d\s]/.test(value)) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14 ? digits : "";
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
  expanded: Array<Set<string>>;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function expand(tokens: string[]): Set<string> {
  const bag = new Set(tokens);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (/^\d+$/.test(tokens[index])) bag.add(tokens[index] + tokens[index + 1]);
  }
  for (const token of tokens) {
    const matched = /^(\d+)([a-zа-я]+)$/i.exec(token);
    if (!matched) continue;
    bag.add(matched[1]);
    bag.add(matched[2]);
  }
  return bag;
}

function preferUnit(items: CatalogItem[], unit: string): CatalogItem | null {
  if (items.length === 0) return null;
  return items.find((item) => !unitsConflict(unit, item.unit)) ?? items[0];
}

function applyUnit(decision: MatchDecision, rowUnit: string, item: CatalogItem): MatchDecision {
  if (!unitsConflict(rowUnit, item.unit)) return decision;
  const note = "единица не совпала";
  return {
    ...decision,
    confidence: Math.max(0, decision.confidence - 20),
    reason: decision.reason.includes(note) ? decision.reason : `${decision.reason}, ${note}`,
  };
}

export function buildCatalogIndex(catalog: CatalogItem[]): CatalogIndex {
  const byCode = new Map<string, CatalogItem[]>();
  const byBarcode = new Map<string, CatalogItem[]>();
  const tokenToIds = new Map<string, number[]>();
  const expanded: Array<Set<string>> = [];

  catalog.forEach((item, index) => {
    const tokens = tokenize(item.name);
    const bag = expand(tokens);
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

  return { items: catalog, byCode, byBarcode, tokenToIds, expanded };
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

function confidenceFromRatio(ratio: number): number | null {
  if (ratio >= 0.75) return 75;
  if (ratio >= 0.5) return 50;
  return null;
}

function keywordHits(keyword: string, catalogTokens: Set<string>): boolean {
  if (catalogTokens.has(keyword)) return true;
  for (const part of expand([keyword])) {
    if (part !== keyword && part.length >= 2 && catalogTokens.has(part)) return true;
  }
  return false;
}

function fuzzyFind(
  row: DisplayRow,
  index: CatalogIndex,
  exclude?: string,
): { item: CatalogItem; confidence: number } | null {
  const keywords = tokenize(row.name);
  if (keywords.length === 0) return null;
  const anchors = keywords.filter((keyword) => /\p{L}/u.test(keyword) && keyword.length >= 3);
  const seeds = anchors.length > 0 ? anchors : keywords;
  let rarest: number[] = [];
  for (const keyword of seeds) {
    for (const token of expand([keyword])) {
      const list = index.tokenToIds.get(token);
      if (!list || list.length === 0) continue;
      if (rarest.length === 0 || list.length < rarest.length) rarest = list;
    }
  }
  const candidateIds = new Set(rarest.slice(0, 400));

  let best: { item: CatalogItem; confidence: number; letters: number; unitRank: number; sizeGap: number } | null = null;
  for (const id of candidateIds) {
    const item = index.items[id];
    if (!item || item.code === exclude) continue;
    const bag = index.expanded[id] ?? new Set<string>();
    let hits = 0;
    let letters = 0;
    for (const keyword of keywords) {
      if (!keywordHits(keyword, bag)) continue;
      hits += 1;
      if (/\p{L}/u.test(keyword)) letters += 1;
    }
    const confidence = confidenceFromRatio(hits / keywords.length);
    if (confidence === null) continue;
    const candidate = {
      item,
      confidence,
      letters,
      unitRank: unitsConflict(row.unit, item.unit) ? 0 : 1,
      sizeGap: Math.abs(bag.size - keywords.length),
    };
    if (
      !best ||
      candidate.confidence > best.confidence ||
      (candidate.confidence === best.confidence && candidate.letters > best.letters) ||
      (candidate.confidence === best.confidence && candidate.letters === best.letters && candidate.unitRank > best.unitRank) ||
      (candidate.confidence === best.confidence &&
        candidate.letters === best.letters &&
        candidate.unitRank === best.unitRank &&
        candidate.sizeGap < best.sizeGap)
    ) {
      best = candidate;
    }
  }
  return best ? { item: best.item, confidence: best.confidence } : null;
}

export function suggestMatch(row: DisplayRow, index: CatalogIndex, excludeCode?: string): MatchDecision {
  const empty: MatchDecision = { status: "need", code: "", confidence: 0, reason: "", relation: "exact" };
  if (index.items.length === 0) return empty;

  const byBarcode = lookupBarcode(index, row.barcode, row.unit, excludeCode);
  if (byBarcode) {
    const conflict = catalogConflict(row, byBarcode.name);
    if (conflict) {
      return { status: "review", code: byBarcode.code, confidence: 40, reason: `${conflict}. В каталоге: «${byBarcode.name}».`, relation: "exact" };
    }
    if (unitsConflict(row.unit, byBarcode.unit)) {
      return { status: "review", code: byBarcode.code, confidence: 70, reason: "по штрихкоду, единица не совпала", relation: "exact" };
    }
    return { status: "confirmed", code: byBarcode.code, confidence: 100, reason: "по штрихкоду", relation: "exact" };
  }

  const fuzzy = fuzzyFind(row, index, excludeCode);
  if (!fuzzy) return empty;
  const status = fuzzy.confidence >= 70 ? "review" : "need";
  return applyUnit(
    { status, code: fuzzy.item.code, confidence: fuzzy.confidence, reason: "по названию", relation: "exact" },
    row.unit,
    fuzzy.item,
  );
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
    if (previous?.status === "missing" && recalled.kind === "none") {
      matches[row.key] = previous;
      continue;
    }
    const suggested = suggestMatch(row, index);
    if (suggested.status === "confirmed" && suggested.code) remember(row.key, suggested);
    else matches[row.key] = suggested;
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
  return { status: "review", code: hit.code, confidence: 40, reason, relation: "exact" };
}

function decisionFromRecall(recalled: Recall): MatchDecision {
  return { status: "review", code: recalled.code, confidence: recalled.confidence, reason: recalled.reason, relation: "exact" };
}

export function dismissReview(state: AppState, key: string): AppState {
  const row = listRows(state.uploads).find((item) => item.key === key);
  if (!row) return state;
  return applyAutoMatch({
    ...state,
    reviewPasses: { ...state.reviewPasses, [passKey(row)]: true },
  });
}
