/** Нормализованные данные тестового модуля потребности (CZ-10). Источник сейчас — Excel; позже — API 1С. */

export type DemandSourceKind =
  | "stock"
  | "turnover"
  | "calendar"
  | "costOrg1"
  | "costOrg2";

export interface DemandSourceMeta {
  kind: DemandSourceKind;
  fileName: string;
  loadedAt: string;
  /** Для оборачиваемости — период из шапки отчёта, если удалось распознать. */
  periodLabel: string;
  rowCount: number;
  /** Заголовки, которые не удалось привязать к полям. */
  unrecognizedHeaders: string[];
  matchedHeaders: string[];
}

export interface DemandIdentity {
  code: string;
  barcode: string;
  name: string;
}

/** Строка остатков после нормализации (ещё до сопоставления с каталогом). */
export interface DemandStockRow {
  id: string;
  identity: DemandIdentity;
  onHand: number | null;
  shipping: number | null;
  reserved: number | null;
  available: number | null;
  expected: number | null;
  toSupply: number | null;
  deficit: number | null;
  surplus: number | null;
}

/** Строка оборачиваемости после нормализации. */
export interface DemandTurnoverRow {
  id: string;
  identity: DemandIdentity;
  endBalance: number | null;
  avgBalance: number | null;
  consumption: number | null;
  avgDaily: number | null;
  stockDays: number | null;
  turnoverPeriod: number | null;
}

/** Контрольные строки (календарь / себестоимость) — без влияния на формулу. */
export interface DemandControlRow {
  id: string;
  identity: DemandIdentity;
  source: "calendar" | "costOrg1" | "costOrg2";
  note: string;
  values: Record<string, number | null>;
}

export interface DemandDecision {
  catalogCode: string;
  /** Какой сценарий дней был ориентиром при решении. */
  scenarioDays: 7 | 14 | 21 | 30 | null;
  /** Рекомендация программы в упаковках на момент решения (если кратность была). */
  recommendedPacks: number | null;
  recommendedQty: number | null;
  /** Решение пользователя в упаковках; если кратности нет — в штуках. */
  userPacks: number | null;
  userQty: number | null;
  agreedWithCalculation: boolean;
  comment: string;
  decidedAt: string;
}

export interface DemandWorkspace {
  version: 1;
  sources: Partial<Record<DemandSourceKind, DemandSourceMeta>>;
  stock: DemandStockRow[];
  turnover: DemandTurnoverRow[];
  control: DemandControlRow[];
  /** Ручная кратность по коду каталога. null в записи не храним — отсутствие ключа = авто. */
  packOverrides: Record<string, number>;
  decisions: Record<string, DemandDecision>;
  /** Тестовый переключатель: вычитать «Ожидается» из потребности. */
  includeExpectedReceipts: boolean;
}

export function emptyDemandWorkspace(): DemandWorkspace {
  return {
    version: 1,
    sources: {},
    stock: [],
    turnover: [],
    control: [],
    packOverrides: {},
    decisions: {},
    includeExpectedReceipts: false,
  };
}

export const COVER_DAYS = [7, 14, 21, 30] as const;
export type CoverDays = (typeof COVER_DAYS)[number];
