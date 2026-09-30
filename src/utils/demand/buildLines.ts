import type { CatalogItem } from "../../types";
import { buildCatalogIndexes, matchIdentityToCatalog } from "./matchCatalog";
import { calculateDemand, formatScenarioCell, type DemandCalcResult } from "./calculate";
import type {
  CoverDays,
  DemandDecision,
  DemandIdentity,
  DemandStockRow,
  DemandTurnoverRow,
  DemandWorkspace,
} from "./types";
import { COVER_DAYS } from "./types";

export interface UnmatchedDemandRow {
  id: string;
  source: "stock" | "turnover";
  identity: DemandIdentity;
  reason: string;
}

export interface DemandLine {
  catalogCode: string;
  name: string;
  unit: string;
  barcode: string;
  onHand: number | null;
  available: number | null;
  expected: number | null;
  consumption: number | null;
  avgDaily: number | null;
  stockDays: number | null;
  packSize: number | null;
  calc: DemandCalcResult;
  decision: DemandDecision | null;
  matchMethod: string;
}

function preferNumber(primary: number | null, secondary: number | null): number | null {
  return primary !== null ? primary : secondary;
}

function maxNeed(calc: DemandCalcResult): number {
  return Math.max(...COVER_DAYS.map((days) => calc.scenarios[days].qty));
}

export function buildDemandLines(workspace: DemandWorkspace, catalog: CatalogItem[]): {
  lines: DemandLine[];
  unmatched: UnmatchedDemandRow[];
} {
  const indexes = buildCatalogIndexes(catalog);
  const stockByCode = new Map<string, DemandStockRow>();
  const turnoverByCode = new Map<string, DemandTurnoverRow>();
  const unmatched: UnmatchedDemandRow[] = [];
  const methods = new Map<string, string>();

  for (const row of workspace.stock) {
    const match = matchIdentityToCatalog(row.identity, indexes);
    if (!match.item) {
      unmatched.push({
        id: row.id,
        source: "stock",
        identity: row.identity,
        reason: match.ambiguous ? "Неоднозначное сопоставление" : "Не удалось сопоставить с номенклатурой 1С",
      });
      continue;
    }
    stockByCode.set(match.item.code, row);
    methods.set(match.item.code, match.method ?? "");
  }

  for (const row of workspace.turnover) {
    const match = matchIdentityToCatalog(row.identity, indexes);
    if (!match.item) {
      unmatched.push({
        id: row.id,
        source: "turnover",
        identity: row.identity,
        reason: match.ambiguous ? "Неоднозначное сопоставление" : "Не удалось сопоставить с номенклатурой 1С",
      });
      continue;
    }
    turnoverByCode.set(match.item.code, row);
    if (!methods.has(match.item.code)) methods.set(match.item.code, match.method ?? "");
  }

  const codes = new Set([...stockByCode.keys(), ...turnoverByCode.keys()]);
  const catalogByCode = new Map(catalog.map((item) => [item.code, item]));
  const lines: DemandLine[] = [];

  for (const code of codes) {
    const item = catalogByCode.get(code);
    if (!item) continue;
    const stock = stockByCode.get(code);
    const turn = turnoverByCode.get(code);
    const available = preferNumber(stock?.available ?? null, null);
    const onHand = preferNumber(stock?.onHand ?? null, turn?.endBalance ?? null);
    const expected = stock?.expected ?? null;
    const avgDaily = turn?.avgDaily ?? null;
    const calc = calculateDemand({
      name: item.name,
      available,
      onHand,
      expected,
      avgDaily,
      stockDays: turn?.stockDays ?? null,
      packOverride: workspace.packOverrides[code],
      includeExpectedReceipts: workspace.includeExpectedReceipts,
    });
    lines.push({
      catalogCode: code,
      name: item.name,
      unit: item.unit,
      barcode: item.barcode ?? "",
      onHand,
      available,
      expected,
      consumption: turn?.consumption ?? null,
      avgDaily,
      stockDays: calc.stockDaysShown,
      packSize: calc.packSize,
      calc,
      decision: workspace.decisions[code] ?? null,
      matchMethod: methods.get(code) ?? "",
    });
  }

  return { lines, unmatched };
}

export type DemandFilter = "all" | "need" | "enough" | "noPack" | "unmatched";
export type DemandSort = "name" | "avgDaily" | "stockDays" | "need" | "onHand";

export function lineNeedsPurchase(line: DemandLine): boolean {
  return COVER_DAYS.some((days) => line.calc.scenarios[days].qty > 0);
}

export function filterDemandLines(lines: DemandLine[], filter: DemandFilter): DemandLine[] {
  if (filter === "all") return lines;
  if (filter === "need") return lines.filter(lineNeedsPurchase);
  if (filter === "enough") return lines.filter((line) => !lineNeedsPurchase(line));
  if (filter === "noPack") return lines.filter((line) => line.packSize === null);
  return lines;
}

export function sortDemandLines(lines: DemandLine[], sort: DemandSort): DemandLine[] {
  const copy = [...lines];
  copy.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ru");
    if (sort === "avgDaily") return (b.avgDaily ?? -1) - (a.avgDaily ?? -1);
    if (sort === "stockDays") {
      const left = a.stockDays ?? Number.POSITIVE_INFINITY;
      const right = b.stockDays ?? Number.POSITIVE_INFINITY;
      return left - right;
    }
    if (sort === "need") return maxNeed(b.calc) - maxNeed(a.calc);
    return (a.onHand ?? Number.POSITIVE_INFINITY) - (b.onHand ?? Number.POSITIVE_INFINITY);
  });
  return copy;
}

export function scenarioLabel(line: DemandLine, days: CoverDays): string {
  return formatScenarioCell(line.calc.scenarios[days], line.packSize);
}
