import type { AppState, CatalogItem } from "../types";
import { absentKey, todayISO } from "./format";
import { catalogMap, listRows } from "./rows";
import { unitRelation } from "./units";

export interface OrderOffer {
  supplier: string;
  price: number;
  unit: string;
}

export interface OrderLine {
  code: string;
  name: string;
  unit: string;
  best: OrderOffer | null;
  second: OrderOffer | null;
  warnings: string[];
  errors: string[];
  fixed: boolean;
}

export interface OrderDraft {
  lines: OrderLine[];
  truncated: boolean;
  total: number;
}

export function countReadyMatches(state: AppState): number {
  const rows = listRows(state.uploads);
  return rows.filter((row) => {
    const status = state.matches[row.key]?.status;
    return status === "confirmed" || status === "picked";
  }).length;
}

export function buildOrder(state: AppState, today = todayISO()): OrderDraft {
  const rows = listRows(state.uploads);
  const catalog = catalogMap(state.catalog);
  const groups = new Map<string, typeof rows>();

  for (const row of rows) {
    const match = state.matches[row.key];
    if (!match || (match.status !== "confirmed" && match.status !== "picked") || !match.code) continue;
    const list = groups.get(match.code) ?? [];
    list.push(row);
    groups.set(match.code, list);
  }

  const lines: OrderLine[] = [];
  for (const [code, grouped] of groups) {
    const item: CatalogItem | undefined = catalog.get(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    const available = grouped.filter((row) => state.absent[absentKey(code, row.supplier)] !== today);
    let conflicts = 0;
    const pool = available.filter((row) => {
      const relation = unitRelation(row.unit, item?.unit ?? "");
      if (relation === "conflict") {
        conflicts += 1;
        return false;
      }
      return true;
    });

    if (available.length === 0) errors.push("Нет в наличии у поставщиков");
    else if (pool.length === 0) errors.push("Нет строки с правильной единицей");
    else if (conflicts > 0) warnings.push("Единица не совпала");

    const bySupplier = new Map<string, OrderOffer>();
    for (const row of pool) {
      const previous = bySupplier.get(row.supplier);
      if (!previous || row.price < previous.price) {
        bySupplier.set(row.supplier, { supplier: row.supplier, price: row.price, unit: row.unit });
      }
    }
    const ranked = [...bySupplier.values()].sort(
      (a, b) => a.price - b.price || a.supplier.localeCompare(b.supplier, "ru"),
    );
    const best = ranked[0] ?? null;
    const second = ranked[1] ?? null;
    const fixed = Boolean(
      best && state.confirmed[code]?.supplier === best.supplier && state.confirmed[code]?.date === today,
    );

    lines.push({
      code,
      name: item?.name ?? code,
      unit: item?.unit ?? "",
      best,
      second,
      warnings,
      errors,
      fixed,
    });
  }

  lines.sort((a, b) => {
    const aProblem = a.errors.length > 0 ? 0 : 1;
    const bProblem = b.errors.length > 0 ? 0 : 1;
    if (aProblem !== bProblem) return aProblem - bProblem;
    return a.name.localeCompare(b.name, "ru");
  });

  return {
    lines: lines.slice(0, 80),
    truncated: lines.length > 80,
    total: lines.length,
  };
}
