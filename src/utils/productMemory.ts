import type { AppState, DisplayRow, MatchDecision, ProductMemory, ProductTraits } from "../types";
import { listRows } from "./rows";
import { supplierKey } from "./text";

const STOP = new Set(["и", "или", "в", "во", "на", "по", "для", "с", "со", "к", "ко", "от", "из", "у", "о", "об", "а", "но", "не", "да", "же", "ли", "бы"]);
const UNIT_TOKENS = new Set(["мл", "ml", "кг", "kg", "гр", "gr", "шт", "уп", "упак", "pcs"]);

const KIND_STEMS: Array<[string, string]> = [
  ["кондиционер", "кондиционер"],
  ["ополаскивател", "ополаскиватель"],
  ["шампунь", "шампунь"],
  ["бальзам", "бальзам"],
  ["порошок", "порошок"],
  ["мыло", "мыло"],
  ["паста", "паста"],
  ["крем", "крем"],
  ["спрей", "спрей"],
  ["жидкост", "жидкость"],
  ["капсул", "капсулы"],
  ["таблет", "таблетки"],
  ["салфет", "салфетки"],
  ["гель", "гель"],
];

const PURPOSE_STEMS: Array<[string, string]> = [
  ["стир", "стирка"],
  ["посуд", "посуда"],
  ["волос", "волосы"],
  ["бель", "белье"],
  ["стекл", "стекло"],
  ["унитаз", "унитаз"],
  ["кухн", "кухня"],
];

export interface Recall {
  kind: "none" | "rejected" | "matched" | "review";
  memoryId: string;
  code: string;
  matchStatus: "confirmed" | "picked" | "";
  confidence: number;
  reason: string;
}

const NONE: Recall = { kind: "none", memoryId: "", code: "", matchStatus: "", confidence: 0, reason: "" };

function stemHit(token: string, stem: string): boolean {
  if (token === stem) return true;
  if (stem.length >= 4 && token.startsWith(stem)) return true;
  if (token.length >= 4 && stem.startsWith(token)) return true;
  return false;
}

function firstStem(tokens: string[], stems: Array<[string, string]>): string {
  for (const token of tokens) {
    for (const [stem, label] of stems) {
      if (stemHit(token, stem)) return label;
    }
  }
  return "";
}

function canon(token: string): string {
  return token.length >= 5 ? token.slice(0, 5) : token;
}

function barcodeOf(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : "";
}

function measures(text: string): { ml: number; g: number } {
  const source = text.toLowerCase().replace(/ё/g, "е");
  let ml = 0;
  let g = 0;
  const pattern = /(\d+(?:[.,]\d+)?)\s*(мл|ml|кг|kg|гр|gr|г|g|л|l)(?![\p{L}\p{N}])/giu;
  for (const match of source.matchAll(pattern)) {
    const value = Number(match[1].replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2].toLowerCase();
    if (unit === "мл" || unit === "ml") ml = Math.round(value);
    else if (unit === "л" || unit === "l") ml = Math.round(value * 1000);
    else if (unit === "кг" || unit === "kg") g = Math.round(value * 1000);
    else g = Math.round(value);
  }
  return { ml, g };
}

export function traitsFromRow(row: DisplayRow): ProductTraits {
  const source = `${row.name} ${row.volume} ${row.pack}`.replace(/ё/g, "е").replace(/д\s*\/\s*/gi, "для ");
  const tokens = source
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP.has(token) && !UNIT_TOKENS.has(token.toLowerCase()) && !/^\d+(?:[.,]\d+)?$/.test(token));
  const kind = firstStem(tokens, KIND_STEMS);
  const purpose = firstStem(tokens, PURPOSE_STEMS);
  const brands = tokens.filter((token) => /^[a-z][a-z0-9]{1,14}$/i.test(token) && !UNIT_TOKENS.has(token.toLowerCase())).map((token) => token.toLowerCase());
  const brandSet = new Set(brands);
  const variants = tokens
    .filter((token) => /\p{L}/u.test(token) && !brandSet.has(token.toLowerCase()) && !UNIT_TOKENS.has(token.toLowerCase()))
    .filter((token) => !KIND_STEMS.some(([stem]) => stemHit(token, stem)) && !PURPOSE_STEMS.some(([stem]) => stemHit(token, stem)))
    .map(canon);
  const size = measures(source);
  return {
    barcode: barcodeOf(row.barcode),
    name: row.name,
    brands: [...new Set(brands)],
    kind,
    purpose,
    variants: [...new Set(variants)],
    ml: size.ml,
    g: size.g,
    pack: row.pack.trim(),
    unit: row.unit.trim(),
  };
}

export function passKey(row: DisplayRow): string {
  const traits = traitsFromRow(row);
  return [
    supplierKey(row.supplier),
    traits.barcode,
    traits.kind,
    traits.purpose,
    traits.brands.slice().sort().join(","),
    traits.variants.slice().sort().join(","),
    String(traits.ml),
    String(traits.g),
  ].join("|");
}

function core(traits: ProductTraits): Set<string> {
  return new Set([traits.kind, traits.purpose, ...traits.brands, ...traits.variants].filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

function shares(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const bag = new Set(right);
  return left.some((token) => bag.has(token));
}

function measureProblem(left: ProductTraits, right: ProductTraits): string {
  if (left.ml > 0 && right.ml > 0 && left.ml !== right.ml) return "объём отличается";
  if (left.g > 0 && right.g > 0 && left.g !== right.g) return "вес отличается";
  if (left.ml > 0 && left.g === 0 && right.g > 0 && right.ml === 0) return "фасовка отличается";
  if (right.ml > 0 && right.g === 0 && left.g > 0 && left.ml === 0) return "фасовка отличается";
  return "";
}

function contradiction(left: ProductTraits, right: ProductTraits): string {
  if (left.kind && right.kind && left.kind !== right.kind) return "тип товара отличается";
  if (left.purpose && right.purpose && left.purpose !== right.purpose) return "назначение отличается";
  const size = measureProblem(left, right);
  if (size) return size;
  if (left.brands.length > 0 && right.brands.length > 0 && !shares(left.brands, right.brands)) return "бренд отличается";
  if (left.variants.length > 0 && right.variants.length > 0) {
    const rightSet = new Set(right.variants);
    const leftSet = new Set(left.variants);
    const leftOnly = left.variants.some((token) => !rightSet.has(token));
    const rightOnly = right.variants.some((token) => !leftSet.has(token));
    if (leftOnly && rightOnly) return "характеристика отличается";
  }
  return "";
}

function linkScore(left: ProductTraits, right: ProductTraits): number {
  if (left.barcode && right.barcode && left.barcode === right.barcode) return 100;
  const score = jaccard(core(left), core(right));
  const size = measureProblem(left, right);
  if (score >= 0.6 && !size) return Math.round(score * 99);
  if (score >= 0.6 && size) return 50;
  if (!size && shares(left.brands, right.brands) && shares(left.variants, right.variants)) return 55;
  return 0;
}

function sameSupplier(memory: ProductMemory, row: DisplayRow): boolean {
  return supplierKey(memory.supplier) === supplierKey(row.supplier);
}

export function recallProduct(memory: Record<string, ProductMemory>, row: DisplayRow, passes: Record<string, boolean> = {}): Recall {
  const traits = traitsFromRow(row);
  let apply: { item: ProductMemory; score: number } | null = null;
  let review: { item: ProductMemory; score: number; problem: string } | null = null;
  for (const item of Object.values(memory)) {
    if (!sameSupplier(item, row)) continue;
    const score = linkScore(traits, item.traits);
    if (score <= 0) continue;
    const problem = contradiction(traits, item.traits);
    if (!problem) {
      if (!apply || score > apply.score) apply = { item, score };
    } else if (!review || score > review.score) {
      review = { item, score, problem };
    }
  }
  if (apply && (!review || apply.score >= review.score)) {
    const item = apply.item;
    if (item.verdict === "rejected") {
      return { kind: "rejected", memoryId: item.id, code: "", matchStatus: "", confidence: apply.score, reason: "не работаем" };
    }
    return {
      kind: "matched",
      memoryId: item.id,
      code: item.catalogCode,
      matchStatus: item.matchStatus === "picked" ? "picked" : "confirmed",
      confidence: apply.score,
      reason: item.reason || "известное сопоставление",
    };
  }
  if (review && !passes[passKey(row)]) {
    return {
      kind: "review",
      memoryId: review.item.id,
      code: "",
      matchStatus: "",
      confidence: review.score,
      reason: `На проверке: похоже на «${review.item.traits.name}», но ${review.problem}`,
    };
  }
  return NONE;
}

function supplierIdFor(state: AppState, supplier: string): string {
  return state.suppliers.find((card) => supplierKey(card.name) === supplierKey(supplier))?.id ?? "";
}

function writeMemory(state: AppState, row: DisplayRow, verdict: "rejected" | "matched", decision: MatchDecision): Record<string, ProductMemory> {
  const traits = traitsFromRow(row);
  const recalled = recallProduct(state.productMemory, row);
  const reusable = recalled.kind === "rejected" || recalled.kind === "matched" ? state.productMemory[recalled.memoryId] : undefined;
  const id = reusable?.id ?? `mem-${crypto.randomUUID()}`;
  const next: ProductMemory = {
    id,
    supplierId: reusable?.supplierId || supplierIdFor(state, row.supplier),
    supplier: row.supplier,
    verdict,
    catalogCode: verdict === "matched" ? decision.code : "",
    matchStatus: verdict === "matched" && decision.status === "picked" ? "picked" : verdict === "matched" ? "confirmed" : "",
    reason: decision.reason,
    traits,
    updatedAt: new Date().toISOString(),
  };
  return { ...state.productMemory, [id]: next };
}

export function rejectProduct(state: AppState, key: string): AppState {
  const row = listRows(state.uploads).find((item) => item.key === key);
  if (!row) return state;
  const decision: MatchDecision = { status: "rejected", code: "", confidence: 100, reason: "не работаем" };
  const reviewPasses = { ...state.reviewPasses };
  delete reviewPasses[passKey(row)];
  const cleared = { ...state.cleared };
  delete cleared[key];
  return {
    ...state,
    cleared,
    reviewPasses,
    productMemory: writeMemory(state, row, "rejected", decision),
    matches: { ...state.matches, [key]: decision },
  };
}

export function saveKnownMatch(state: AppState, key: string, decision: MatchDecision): AppState {
  const row = listRows(state.uploads).find((item) => item.key === key);
  if (!row || (decision.status !== "confirmed" && decision.status !== "picked") || !decision.code) return state;
  const reviewPasses = { ...state.reviewPasses };
  delete reviewPasses[passKey(row)];
  const cleared = { ...state.cleared };
  delete cleared[key];
  return {
    ...state,
    cleared,
    reviewPasses,
    productMemory: writeMemory(state, row, "matched", decision),
    matches: { ...state.matches, [key]: decision },
  };
}

export function rememberedInBoth(memory: Record<string, ProductMemory>, previous: DisplayRow, next: DisplayRow[]): boolean {
  const known = recallProduct(memory, previous);
  if (known.kind !== "rejected" && known.kind !== "matched") return false;
  return next.some((row) => {
    const found = recallProduct(memory, row);
    return found.memoryId === known.memoryId && found.kind === known.kind;
  });
}

export function releaseProduct(state: AppState, memoryId: string): AppState {
  if (!state.productMemory[memoryId]) return state;
  const productMemory = { ...state.productMemory };
  delete productMemory[memoryId];
  return { ...state, productMemory };
}
