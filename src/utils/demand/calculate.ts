import { COVER_DAYS, type CoverDays } from "./types";
import { resolvePackMultiplicity } from "./packSize";

export interface ScenarioNeed {
  days: CoverDays;
  targetStock: number;
  rawNeed: number;
  packs: number | null;
  qty: number;
}

export interface DemandCalcInput {
  name: string;
  available: number | null;
  onHand: number | null;
  expected: number | null;
  avgDaily: number | null;
  stockDays: number | null;
  packOverride?: number;
  includeExpectedReceipts: boolean;
}

export interface DemandCalcResult {
  packSize: number | null;
  stockDaysShown: number | null;
  scenarios: Record<CoverDays, ScenarioNeed>;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function stockDaysFrom(available: number | null, avgDaily: number | null, reported: number | null): number | null {
  if (reported !== null && Number.isFinite(reported)) return reported;
  if (available === null || avgDaily === null || avgDaily <= 0) return null;
  return round3(available / avgDaily);
}

export function calculateDemand(input: DemandCalcInput): DemandCalcResult {
  const packSize = resolvePackMultiplicity(input.name, input.packOverride);
  const available = input.available ?? input.onHand ?? 0;
  const expected = input.includeExpectedReceipts ? Math.max(0, input.expected ?? 0) : 0;
  const avgDaily = Math.max(0, input.avgDaily ?? 0);
  const scenarios = {} as Record<CoverDays, ScenarioNeed>;

  for (const days of COVER_DAYS) {
    const targetStock = round3(avgDaily * days);
    const raw = round3(targetStock - available - expected);
    const rawNeed = raw > 0 ? raw : 0;
    if (packSize && packSize > 1) {
      const packs = rawNeed > 0 ? Math.ceil(rawNeed / packSize) : 0;
      scenarios[days] = {
        days,
        targetStock,
        rawNeed,
        packs,
        qty: packs * packSize,
      };
    } else {
      scenarios[days] = {
        days,
        targetStock,
        rawNeed,
        packs: null,
        qty: Math.ceil(rawNeed),
      };
    }
  }

  return {
    packSize,
    stockDaysShown: stockDaysFrom(available, input.avgDaily, input.stockDays),
    scenarios,
  };
}

export function formatScenarioCell(scenario: ScenarioNeed, packSize: number | null): string {
  if (scenario.rawNeed <= 0 || scenario.qty <= 0) return "0";
  if (packSize && scenario.packs !== null) {
    return `${scenario.packs} кор. / ${formatQty(scenario.qty)} шт.`;
  }
  return `${formatQty(scenario.qty)} шт.`;
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

export function explainCalculation(input: DemandCalcInput, days: CoverDays): string[] {
  const result = calculateDemand(input);
  const scenario = result.scenarios[days];
  const available = input.available ?? input.onHand ?? 0;
  const avgDaily = input.avgDaily ?? 0;
  const lines = [
    input.name,
    "",
    `Среднедневное потребление: ${formatQty(avgDaily)} шт.`,
    `В наличии: ${input.onHand === null ? "—" : formatQty(input.onHand)} шт.`,
    `Доступно: ${input.available === null ? "—" : formatQty(input.available)} шт.`,
    `Ожидается: ${input.expected === null ? "—" : formatQty(input.expected)} шт.${input.includeExpectedReceipts ? " (учтено в расчёте)" : " (в расчёте не учтено)"}`,
    `Упаковка: ${result.packSize ? `${result.packSize} шт.` : "кратность не определена"}`,
    "",
    `Сценарий ${days} дней:`,
    `${formatQty(avgDaily)} × ${days} = ${formatQty(scenario.targetStock)} шт.`,
    `− ${formatQty(available)} доступно${input.includeExpectedReceipts && (input.expected ?? 0) > 0 ? ` − ${formatQty(Math.max(0, input.expected ?? 0))} ожидается` : ""}`,
    `= ${formatQty(scenario.rawNeed)} шт. потребность.`,
  ];
  if (result.packSize && scenario.packs !== null) {
    lines.push("");
    lines.push(`${formatQty(scenario.rawNeed)} / ${result.packSize} = ${formatQty(scenario.rawNeed / result.packSize)} упаковки.`);
    lines.push(`Тестовая рекомендация: ${scenario.packs} упак. = ${formatQty(scenario.qty)} шт.`);
  } else {
    lines.push("");
    lines.push(`Тестовая рекомендация: ${formatQty(scenario.qty)} шт. (кратность не определена, без округления до упаковки).`);
  }
  return lines;
}
