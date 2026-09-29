import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState, CatalogItem, ColumnMapper, SupplierCard, Upload } from "../types";
import { absentKey, todayISO } from "../utils/format";
import { applyAutoMatch, buildCatalogIndex, dismissReview, suggestMatch } from "../utils/matching";
import { rejectProduct, releaseProduct, saveKnownMatch } from "../utils/productMemory";
import { acceptCurrentPrice, upsertSupplier, type AcceptedPrice } from "../utils/procurement";
import { loadPersistedState, savePersistedState } from "../utils/persist";
import { listRows } from "../utils/rows";
import { emptyState } from "../utils/storage";
import { createSupplier } from "../utils/suppliers";
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
  saveSupplier: (card: SupplierCard) => void;
  acceptSupplierPrice: (input: AcceptedPrice) => { ok: boolean; reason: string };
  acceptSupplierPrices: (inputs: AcceptedPrice[], card?: SupplierCard) => { ok: boolean; reason: string };
  correctSupplierPrice: (inputs: AcceptedPrice[], card?: SupplierCard) => { ok: boolean; reason: string };
  commitCatalog: (items: CatalogItem[]) => void;
  confirmMatch: (key: string) => void;
  offerAlternative: (key: string) => void;
  pickMatch: (key: string, code: string) => void;
  markMissing: (key: string) => void;
  rejectMatch: (key: string) => void;
  releaseMatch: (memoryId: string) => void;
  dismissReviewMatch: (key: string) => void;
  confirmOrder: (code: string, supplier: string, price: number) => void;
  markAbsent: (code: string, supplier: string) => void;
}

const AppStateContext = createContext<AppApi | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const undoPrice = useRef<AppState | null>(null);

  useEffect(() => {
    let active = true;
    loadPersistedState()
      .then((loaded) => {
        if (!active) return;
        const next =
          loaded.uploads.length > 0 && loaded.catalog.length > 0 && Object.keys(loaded.matches).length === 0
            ? applyAutoMatch(loaded)
            : loaded;
        setState(next);
        setHydrated(true);
      })
      .catch(() => {
        if (!active) return;
        setSaveError("Не удалось прочитать сохранённые данные.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    savePersistedState(state).then((error) => {
      if (active) setSaveError(error);
    });
    return () => {
      active = false;
    };
  }, [state, hydrated]);

  const commitPrice = useCallback((upload: Upload, mapper: ColumnMapper) => {
    setState((prev) => {
      let suppliers = prev.suppliers;
      let card = suppliers.find((item) => item.id === upload.supplierId || supplierKey(item.name) === supplierKey(upload.supplier));
      if (!card) {
        card = createSupplier(upload.supplier);
        suppliers = [...suppliers, card];
      }
      const result = acceptCurrentPrice(
        { ...prev, suppliers },
        { supplierId: card.id, fileName: upload.file, receivedAt: upload.uploadedAt, rows: upload.rows, mapper },
      );
      return result.ok ? result.state : prev;
    });
  }, []);

  const saveSupplier = useCallback((card: SupplierCard) => {
    setState((prev) => upsertSupplier(prev, card));
  }, []);

  const applyPrice = useCallback((base: AppState, input: AcceptedPrice) => {
    const result = acceptCurrentPrice(base, input);
    return result;
  }, []);

  const acceptSupplierPrices = useCallback((inputs: AcceptedPrice[], card?: SupplierCard) => {
    let outcome = { ok: false, reason: "Прайс не сохранён." };
    setState((prev) => {
      let next = card ? upsertSupplier(prev, card) : prev;
      const notes: string[] = [];
      const before = next;
      for (const input of inputs) {
        const result = applyPrice(next, input);
        if (!result.ok) {
          notes.push(result.reason);
          continue;
        }
        next = result.state;
        notes.push(result.reason);
      }
      const accepted = next !== before;
      outcome = { ok: accepted, reason: notes.filter(Boolean).join(" ") || (accepted ? "" : "Прайс не сохранён.") };
      if (!accepted) return card ? before : prev;
      undoPrice.current = prev;
      return next;
    });
    return outcome;
  }, [applyPrice]);

  const acceptSupplierPrice = useCallback((input: AcceptedPrice) => acceptSupplierPrices([input]), [acceptSupplierPrices]);

  const correctSupplierPrice = useCallback((inputs: AcceptedPrice[], card?: SupplierCard) => {
    const base = undoPrice.current;
    if (!base) return { ok: false, reason: "Изменить поставщика уже нельзя." };
    let next = card ? upsertSupplier(base, card) : base;
    const notes: string[] = [];
    let ok = false;
    for (const input of inputs) {
      const result = applyPrice(next, input);
      if (!result.ok) {
        notes.push(result.reason);
        continue;
      }
      next = result.state;
      notes.push(result.reason);
      ok = true;
    }
    if (!ok) return { ok: false, reason: notes.join(" ") || "Прайс не сохранён." };
    setState(next);
    return { ok: true, reason: notes.join(" ") };
  }, [applyPrice]);

  const commitCatalog = useCallback((items: CatalogItem[]) => {
    setState((prev) => applyAutoMatch({ ...prev, catalog: items }));
  }, []);

  const confirmMatch = useCallback((key: string) => {
    setState((prev) => {
      const current = prev.matches[key];
      if (!current?.code) return prev;
      return saveKnownMatch(prev, key, { ...current, status: "confirmed" });
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
    setState((prev) => saveKnownMatch(prev, key, { status: "picked", code, confidence: 100, reason: "выбрано вручную" }));
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

  const rejectMatch = useCallback((key: string) => {
    setNotice(null);
    setState((prev) => rejectProduct(prev, key));
  }, []);

  const releaseMatch = useCallback((memoryId: string) => {
    setNotice(null);
    setState((prev) => applyAutoMatch(releaseProduct(prev, memoryId)));
  }, []);

  const dismissReviewMatch = useCallback((key: string) => {
    setNotice(null);
    setState((prev) => dismissReview(prev, key));
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
      saveSupplier,
      acceptSupplierPrice,
      acceptSupplierPrices,
      correctSupplierPrice,
      commitCatalog,
      confirmMatch,
      offerAlternative,
      pickMatch,
      markMissing,
      rejectMatch,
      releaseMatch,
      dismissReviewMatch,
      confirmOrder,
      markAbsent,
    }),
    [
      state,
      saveError,
      notice,
      clearNotice,
      commitPrice,
      saveSupplier,
      acceptSupplierPrice,
      acceptSupplierPrices,
      correctSupplierPrice,
      commitCatalog,
      confirmMatch,
      offerAlternative,
      pickMatch,
      markMissing,
      rejectMatch,
      releaseMatch,
      dismissReviewMatch,
      confirmOrder,
      markAbsent,
    ],
  );

  if (!hydrated) {
    return <div className="mx-auto max-w-[1280px] px-4 py-6 text-sm text-mute">{saveError ?? "Загрузка данных…"}</div>;
  }

  return <AppStateContext.Provider value={api}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppApi {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState вызван вне провайдера");
  return context;
}
