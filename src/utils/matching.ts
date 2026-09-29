import type { AppState, CatalogItem, DisplayRow, MatchDecision } from "../types";
import { listRows } from "./rows";
import { normCode } from "./text";
import { unitsConflict } from "./units";

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
    const digits = item.code.replace(/\D/g, "");
    if (digits.length >= 8) {
      const list = byBarcode.get(digits) ?? [];
      list.push(item);
      byBarcode.set(digits, list);
    }
  });

  return { items: catalog, byCode, byBarcode, tokenToIds, expanded };
}

function lookupCode(index: CatalogIndex, code: string, unit: string, exclude?: string): CatalogItem | null {
  const key = normCode(code);
  if (!key) return null;
  const found = (index.byCode.get(key) ?? []).filter((item) => item.code !== exclude);
  return preferUnit(found, unit);
}

function lookupBarcode(index: CatalogIndex, barcode: string, unit: string, exclude?: string): CatalogItem | null {
  // В выгрузке 1С нет отдельной колонки штрихкода, поэтому штрихкод поставщика сравнивается с кодом номенклатуры.
  const key = normCode(barcode);
  const digits = barcode.replace(/\D/g, "");
  const fromCode = key ? (index.byCode.get(key) ?? []) : [];
  const fromDigits = digits.length >= 8 ? (index.byBarcode.get(digits) ?? []) : [];
  const merged = [...fromCode, ...fromDigits].filter((item, itemIndex, list) => {
    return item.code !== exclude && list.findIndex((other) => other.code === item.code) === itemIndex;
  });
  return preferUnit(merged, unit);
}

function confidenceFromRatio(ratio: number): number | null {
  if (ratio >= 0.999) return 90;
  if (ratio >= 0.75) return 70;
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
  const candidateIds = new Set<number>();
  for (const keyword of seeds) {
    for (const token of expand([keyword])) {
      for (const id of index.tokenToIds.get(token) ?? []) candidateIds.add(id);
    }
  }

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
  const empty: MatchDecision = { status: "need", code: "", confidence: 0, reason: "" };
  if (index.items.length === 0) return empty;

  const byCode = lookupCode(index, row.code, row.unit, excludeCode);
  if (byCode) {
    return applyUnit({ status: "need", code: byCode.code, confidence: 100, reason: "по коду" }, row.unit, byCode);
  }

  const byBarcode = lookupBarcode(index, row.barcode, row.unit, excludeCode);
  if (byBarcode) {
    return applyUnit(
      { status: "need", code: byBarcode.code, confidence: 100, reason: "по штрихкоду" },
      row.unit,
      byBarcode,
    );
  }

  const fuzzy = fuzzyFind(row, index, excludeCode);
  if (!fuzzy) return empty;
  return applyUnit(
    { status: "need", code: fuzzy.item.code, confidence: fuzzy.confidence, reason: "по названию" },
    row.unit,
    fuzzy.item,
  );
}

function isManual(match: MatchDecision): boolean {
  return match.status === "confirmed" || match.status === "picked" || match.status === "missing";
}

export function applyAutoMatch(state: AppState): AppState {
  const rows = listRows(state.uploads);
  const index = buildCatalogIndex(state.catalog);
  const codes = new Set(state.catalog.map((item) => item.code));
  const matches: Record<string, MatchDecision> = { ...state.matches };
  for (const row of rows) {
    const previous = state.matches[row.key];
    if (previous && isManual(previous) && (previous.status === "missing" || codes.has(previous.code))) {
      matches[row.key] = previous;
      continue;
    }
    matches[row.key] = suggestMatch(row, index);
  }
  return { ...state, matches, seenReady: true };
}
