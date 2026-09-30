import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CatalogItem } from "../types";
import { useAppState } from "./useAppState";
import {
  buildDemandLines,
  filterDemandLines,
  sortDemandLines,
  type DemandFilter,
  type DemandLine,
  type DemandSort,
  type UnmatchedDemandRow,
} from "../utils/demand/buildLines";
import { demandHasCoreData, loadDemandWorkspace, saveDemandWorkspace } from "../utils/demand/persistDemand";
import { pickBestSheet, parseControlReport, parseStockReport, parseTurnoverReport } from "../utils/demand/parseReports";
import { emptyDemandWorkspace, type CoverDays, type DemandDecision, type DemandSourceKind, type DemandWorkspace } from "../utils/demand/types";
import { readSheets } from "../utils/parseFile";
import type { DivisionId } from "../utils/divisions";

interface DemandApi {
  ready: boolean;
  workspace: DemandWorkspace;
  hasData: boolean;
  lines: DemandLine[];
  unmatched: UnmatchedDemandRow[];
  filter: DemandFilter;
  setFilter: (filter: DemandFilter) => void;
  sort: DemandSort;
  setSort: (sort: DemandSort) => void;
  query: string;
  setQuery: (query: string) => void;
  busy: boolean;
  error: string | null;
  info: string | null;
  clearMessages: () => void;
  importSource: (kind: DemandSourceKind, file: File) => Promise<void>;
  setIncludeExpected: (value: boolean) => void;
  setPackOverride: (catalogCode: string, packs: number | null) => void;
  saveDecision: (decision: DemandDecision) => void;
  acceptScenario: (line: DemandLine, days: CoverDays) => void;
}

const DemandContext = createContext<DemandApi | null>(null);

function searchLines(lines: DemandLine[], query: string): DemandLine[] {
  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  if (!q) return lines;
  return lines.filter((line) => {
    const hay = `${line.name} ${line.catalogCode} ${line.barcode}`.toLowerCase().replace(/ё/g, "е");
    return hay.includes(q);
  });
}

export function DemandStateProvider({ children }: { children: ReactNode }) {
  const { activeDivision, state } = useAppState();
  const [workspace, setWorkspace] = useState<DemandWorkspace>(emptyDemandWorkspace);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<DemandFilter>("need");
  const [sort, setSort] = useState<DemandSort>("avgDaily");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const divisionRef = useRef<DivisionId>(activeDivision);
  divisionRef.current = activeDivision;

  useEffect(() => {
    let active = true;
    setReady(false);
    loadDemandWorkspace(activeDivision)
      .then((loaded) => {
        if (!active) return;
        setWorkspace(loaded);
        setReady(true);
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setWorkspace(emptyDemandWorkspace());
        setReady(true);
        setError("Не удалось прочитать данные потребности.");
      });
    return () => {
      active = false;
    };
  }, [activeDivision]);

  useEffect(() => {
    if (!ready) return;
    const division = divisionRef.current;
    const snapshot = workspace;
    void saveDemandWorkspace(division, snapshot).catch(() => {
      setError("Не удалось сохранить данные потребности.");
    });
  }, [workspace, ready]);

  const catalog: CatalogItem[] = state.catalog;

  const { lines: allLines, unmatched } = useMemo(() => buildDemandLines(workspace, catalog), [workspace, catalog]);

  const lines = useMemo(() => {
    const filtered = filter === "unmatched" ? [] : filterDemandLines(allLines, filter);
    const found = searchLines(filtered, query);
    return sortDemandLines(found, sort);
  }, [allLines, filter, query, sort]);

  const importSource = useCallback(async (kind: DemandSourceKind, file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const sheets = await readSheets(file);
      const best = pickBestSheet(sheets);
      if (kind === "stock") {
        const parsed = parseStockReport(best.matrix, file.name);
        setWorkspace((prev) => ({
          ...prev,
          stock: parsed.rows,
          sources: { ...prev.sources, stock: parsed.meta },
        }));
        setInfo(`Остатки: загружено ${parsed.rows.length} строк.`);
      } else if (kind === "turnover") {
        const parsed = parseTurnoverReport(best.matrix, file.name);
        setWorkspace((prev) => ({
          ...prev,
          turnover: parsed.rows,
          sources: { ...prev.sources, turnover: parsed.meta },
        }));
        setInfo(`Оборачиваемость: загружено ${parsed.rows.length} строк.`);
      } else {
        const controlKind = kind === "calendar" ? "calendar" : kind === "costOrg1" ? "costOrg1" : "costOrg2";
        const parsed = parseControlReport(best.matrix, file.name, controlKind);
        setWorkspace((prev) => ({
          ...prev,
          control: [...prev.control.filter((row) => row.source !== controlKind), ...parsed.rows],
          sources: { ...prev.sources, [kind]: parsed.meta },
        }));
        setInfo(`Контрольный отчёт загружен: ${parsed.rows.length} строк.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить отчёт.");
    } finally {
      setBusy(false);
    }
  }, []);

  const setIncludeExpected = useCallback((value: boolean) => {
    setWorkspace((prev) => ({ ...prev, includeExpectedReceipts: value }));
  }, []);

  const setPackOverride = useCallback((catalogCode: string, packs: number | null) => {
    setWorkspace((prev) => {
      const packOverrides = { ...prev.packOverrides };
      if (packs === null || !Number.isInteger(packs) || packs <= 1) delete packOverrides[catalogCode];
      else packOverrides[catalogCode] = packs;
      return { ...prev, packOverrides };
    });
  }, []);

  const saveDecision = useCallback((decision: DemandDecision) => {
    setWorkspace((prev) => ({
      ...prev,
      decisions: { ...prev.decisions, [decision.catalogCode]: decision },
    }));
  }, []);

  const acceptScenario = useCallback((line: DemandLine, days: CoverDays) => {
    const scenario = line.calc.scenarios[days];
    const decidedAt = new Date().toISOString();
    saveDecision({
      catalogCode: line.catalogCode,
      scenarioDays: days,
      recommendedPacks: scenario.packs,
      recommendedQty: scenario.qty,
      userPacks: scenario.packs,
      userQty: scenario.qty,
      agreedWithCalculation: true,
      comment: "",
      decidedAt,
    });
  }, [saveDecision]);

  const api = useMemo<DemandApi>(
    () => ({
      ready,
      workspace,
      hasData: demandHasCoreData(workspace),
      lines,
      unmatched,
      filter,
      setFilter,
      sort,
      setSort,
      query,
      setQuery,
      busy,
      error,
      info,
      clearMessages: () => {
        setError(null);
        setInfo(null);
      },
      importSource,
      setIncludeExpected,
      setPackOverride,
      saveDecision,
      acceptScenario,
    }),
    [
      ready,
      workspace,
      lines,
      unmatched,
      filter,
      sort,
      query,
      busy,
      error,
      info,
      importSource,
      setIncludeExpected,
      setPackOverride,
      saveDecision,
      acceptScenario,
    ],
  );

  return <DemandContext.Provider value={api}>{children}</DemandContext.Provider>;
}

export function useDemandState(): DemandApi {
  const context = useContext(DemandContext);
  if (!context) throw new Error("useDemandState вызван вне провайдера");
  return context;
}
