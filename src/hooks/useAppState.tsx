import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppState, CatalogItem, ColumnMapper, Upload } from "../types";
import { absentKey, todayISO } from "../utils/format";
import { applyAutoMatch, buildCatalogIndex, suggestMatch } from "../utils/matching";
import { listRows, matchKey } from "../utils/rows";
import { loadState, saveState } from "../utils/storage";
import { supplierKey } from "../utils/text";

interface Notice {
  tone: "ok" | "warn";
  text: string;
}

interface AppApi {
  state: AppState;
  saveError: string | null;
  notice: Notice | null;
  clearNotice: () => void;
  commitPrice: (upload: Upload, mapper: ColumnMapper) => void;
  commitCatalog: (items: CatalogItem[]) => void;
  confirmMatch: (key: string) => void;
  offerAlternative: (key: string) => void;
  pickMatch: (key: string, code: string) => void;
  markMissing: (key: string) => void;
  confirmOrder: (code: string, supplier: string, price: number) => void;
  markAbsent: (code: string, supplier: string) => void;
}

const AppStateContext = createContext<AppApi | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadState();
    if (loaded.uploads.length > 0 && loaded.catalog.length > 0 && Object.keys(loaded.matches).length === 0) {
      return applyAutoMatch(loaded);
    }
    return loaded;
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    setSaveError(saveState(state));
  }, [state]);

  const commitPrice = useCallback((upload: Upload, mapper: ColumnMapper) => {
    setState((prev) => {
      const uploads = [
        ...prev.uploads.filter((item) => !(item.file === upload.file && item.supplier === upload.supplier)),
        upload,
      ];
      const seen = { ...prev.seen };
      for (const tuple of upload.rows) {
        const [supplier, name, , barcode, code, unit] = tuple;
        const key = matchKey(supplier, name, code, barcode, unit);
        seen[key] = (seen[key] ?? 0) + 1;
      }
      return applyAutoMatch({
        ...prev,
        uploads,
        seen,
        mappers: { ...prev.mappers, [supplierKey(upload.supplier)]: mapper },
      });
    });
  }, []);

  const commitCatalog = useCallback((items: CatalogItem[]) => {
    setState((prev) => applyAutoMatch({ ...prev, catalog: items }));
  }, []);

  const confirmMatch = useCallback((key: string) => {
    setState((prev) => {
      const current = prev.matches[key];
      if (!current?.code) return prev;
      const cleared = { ...prev.cleared };
      delete cleared[key];
      return {
        ...prev,
        cleared,
        matches: { ...prev.matches, [key]: { ...current, status: "confirmed" } },
      };
    });
  }, []);

  const offerAlternative = useCallback((key: string) => {
    const row = listRows(state.uploads).find((item) => item.key === key);
    if (!row) return;
    const current = state.matches[key];
    const next = suggestMatch(row, buildCatalogIndex(state.catalog), current?.code || undefined);
    if (!next.code || next.code === current?.code) {
      setNotice({ tone: "warn", text: "Другого похожего товара нет" });
      return;
    }
    setNotice({ tone: "ok", text: "Предложен другой товар" });
    setState((prev) => {
      const cleared = { ...prev.cleared };
      delete cleared[key];
      return {
        ...prev,
        cleared,
        matches: { ...prev.matches, [key]: { ...next, status: "need" } },
      };
    });
  }, [state]);

  const pickMatch = useCallback((key: string, code: string) => {
    setNotice(null);
    setState((prev) => {
      const cleared = { ...prev.cleared };
      delete cleared[key];
      return {
        ...prev,
        cleared,
        matches: {
          ...prev.matches,
          [key]: { status: "picked", code, confidence: 100, reason: "выбрано вручную" },
        },
      };
    });
  }, []);

  const markMissing = useCallback((key: string) => {
    setNotice(null);
    setState((prev) => ({
      ...prev,
      cleared: { ...prev.cleared, [key]: true },
      matches: {
        ...prev.matches,
        [key]: { status: "missing", code: "", confidence: 0, reason: "" },
      },
    }));
  }, []);

  const confirmOrder = useCallback((code: string, supplier: string, price: number) => {
    setState((prev) => ({
      ...prev,
      confirmed: {
        ...prev.confirmed,
        [code]: { supplier, price, date: todayISO() },
      },
    }));
  }, []);

  const markAbsent = useCallback((code: string, supplier: string) => {
    const today = todayISO();
    setState((prev) => {
      const confirmed = { ...prev.confirmed };
      if (confirmed[code]?.supplier === supplier) delete confirmed[code];
      return {
        ...prev,
        confirmed,
        absent: { ...prev.absent, [absentKey(code, supplier)]: today },
      };
    });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const api = useMemo<AppApi>(
    () => ({
      state,
      saveError,
      notice,
      clearNotice,
      commitPrice,
      commitCatalog,
      confirmMatch,
      offerAlternative,
      pickMatch,
      markMissing,
      confirmOrder,
      markAbsent,
    }),
    [
      state,
      saveError,
      notice,
      clearNotice,
      commitPrice,
      commitCatalog,
      confirmMatch,
      offerAlternative,
      pickMatch,
      markMissing,
      confirmOrder,
      markAbsent,
    ],
  );

  return <AppStateContext.Provider value={api}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppApi {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState вызван вне провайдера");
  return context;
}
