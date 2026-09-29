import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState, CatalogItem, ColumnMapper, SupplierCard, Upload } from "../types";
import { absentKey, todayISO } from "../utils/format";
import { alignCatalog } from "../utils/catalogUpdate";
import { applyAutoMatch, dismissReview, MATCH_LOGIC, reopenSkipped, skipMatches } from "../utils/matching";
import { rejectProduct, rejectProducts, releaseProduct, saveAbsents, saveAbsent, saveAlternative, saveKnownMatch } from "../utils/productMemory";
import { acceptCurrentPrice, setPurchaseNeed, upsertSupplier, type AcceptedPrice } from "../utils/procurement";
import { loadPersistedState, savePersistedState } from "../utils/persist";
import { emptyState } from "../utils/storage";
import { createSupplier } from "../utils/suppliers";
import { supplierKey } from "../utils/text";

interface Notice {
  tone: "ok" | "warn";
  text: string;
}

interface AppApi {
  state: AppState;
  analyzing: boolean;
  saveError: string | null;
  notice: Notice | null;
  clearNotice: () => void;
  commitPrice: (upload: Upload, mapper: ColumnMapper) => void;
  saveSupplier: (card: SupplierCard) => void;
  markPurchaseNeed: (supplierId: string, needed: boolean) => void;
  acceptSupplierPrice: (input: AcceptedPrice) => { ok: boolean; reason: string };
  acceptSupplierPrices: (inputs: AcceptedPrice[], card?: SupplierCard) => { ok: boolean; reason: string };
  correctSupplierPrice: (inputs: AcceptedPrice[], card?: SupplierCard) => { ok: boolean; reason: string };
  commitCatalog: (items: CatalogItem[]) => void;
  restorePreviousCatalog: () => void;
  confirmMatch: (key: string) => void;
  offerAlternative: (key: string) => void;
  pickMatch: (key: string, code: string) => void;
  markMissing: (key: string) => void;
  markMissingMany: (keys: string[]) => void;
  rejectMatch: (key: string) => void;
  rejectMatches: (keys: string[]) => void;
  skipMatchesMany: (keys: string[]) => void;
  restoreSkipped: (key: string) => void;
  releaseMatch: (memoryId: string) => void;
  dismissReviewMatch: (key: string) => void;
  confirmOrder: (code: string, supplier: string, price: number) => void;
  markAbsent: (code: string, supplier: string) => void;
}

const AppStateContext = createContext<AppApi | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const undoPrice = useRef<AppState | null>(null);

  useEffect(() => {
    let active = true;
    loadPersistedState()
      .then((loaded) => {
        if (!active) return;
        const needsMatch = loaded.uploads.length > 0 && loaded.catalog.length > 0 && loaded.matchLogic < MATCH_LOGIC;
        if (!needsMatch) {
          setState(loaded);
          setHydrated(true);
          return;
        }
        setState(loaded);
        setAnalyzing(true);
        setHydrated(true);
        window.setTimeout(() => {
          if (!active) return;
          setState(applyAutoMatch(loaded));
          setAnalyzing(false);
        }, 0);
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
    if (!hydrated || analyzing) return;
    let active = true;
    savePersistedState(state).then((error) => {
      if (active) setSaveError(error);
    });
    return () => {
      active = false;
    };
  }, [state, hydrated, analyzing]);

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

  const markPurchaseNeed = useCallback((supplierId: string, needed: boolean) => {
    setState((prev) => setPurchaseNeed(prev, supplierId, needed));
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
    setAnalyzing(true);
    window.setTimeout(() => {
      setState((prev) => {
        const catalog = alignCatalog(prev.catalog, items);
        return applyAutoMatch({
          ...prev,
          catalog,
          previousCatalog: prev.catalog.length > 0 ? prev.catalog : prev.previousCatalog,
          catalogUpdatedAt: new Date().toISOString(),
        });
      });
      setAnalyzing(false);
    }, 0);
  }, []);

  const restorePreviousCatalog = useCallback(() => {
    setAnalyzing(true);
    window.setTimeout(() => {
      setState((prev) => {
        if (prev.previousCatalog.length === 0) return prev;
        return applyAutoMatch({
          ...prev,
          catalog: prev.previousCatalog,
          previousCatalog: prev.catalog,
          catalogUpdatedAt: new Date().toISOString(),
        });
      });
      setAnalyzing(false);
    }, 0);
  }, []);

  const confirmMatch = useCallback((key: string) => {
    setState((prev) => {
      const current = prev.matches[key];
      if (!current?.code) return prev;
      return saveKnownMatch(prev, key, { ...current, status: "confirmed" });
    });
  }, []);

  const offerAlternative = useCallback((key: string) => {
    const current = state.matches[key];
    if (!current?.code) {
      setNotice({ tone: "warn", text: "Сначала выберите нашу номенклатуру." });
      return;
    }
    setNotice({ tone: "ok", text: "Позиция зафиксирована как альтернатива, не как точное сопоставление." });
    setState((prev) => saveAlternative(prev, key, current.code));
  }, [state]);

  const pickMatch = useCallback((key: string, code: string) => {
    setNotice({ tone: "ok", text: "Позиция выбрана. Нажмите «Подтвердить», чтобы сохранить сопоставление." });
    setState((prev) => ({
      ...prev,
      matches: {
        ...prev.matches,
        [key]: { status: "need", code, confidence: 0, reason: "Выбрано вручную", relation: "exact" },
      },
    }));
  }, []);

  const markMissing = useCallback((key: string) => {
    setNotice(null);
    setState((prev) => saveAbsent(prev, key));
  }, []);

  const markMissingMany = useCallback((keys: string[]) => {
    setNotice(null);
    setState((prev) => saveAbsents(prev, keys));
  }, []);

  const rejectMatch = useCallback((key: string) => {
    setNotice(null);
    setState((prev) => rejectProduct(prev, key));
  }, []);

  const rejectMatches = useCallback((keys: string[]) => {
    setNotice(null);
    setState((prev) => rejectProducts(prev, keys));
  }, []);

  const skipMatchesMany = useCallback((keys: string[]) => {
    setNotice(null);
    setState((prev) => skipMatches(prev, keys));
  }, []);

  const restoreSkipped = useCallback((key: string) => {
    setNotice(null);
    setState((prev) => reopenSkipped(prev, key));
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
      analyzing,
      saveError,
      notice,
      clearNotice,
      commitPrice,
      saveSupplier,
      markPurchaseNeed,
      acceptSupplierPrice,
      acceptSupplierPrices,
      correctSupplierPrice,
      commitCatalog,
      restorePreviousCatalog,
      confirmMatch,
      offerAlternative,
      pickMatch,
      markMissing,
      markMissingMany,
      rejectMatch,
      rejectMatches,
      skipMatchesMany,
      restoreSkipped,
      releaseMatch,
      dismissReviewMatch,
      confirmOrder,
      markAbsent,
    }),
    [
      state,
      analyzing,
      saveError,
      notice,
      clearNotice,
      commitPrice,
      saveSupplier,
      markPurchaseNeed,
      acceptSupplierPrice,
      acceptSupplierPrices,
      correctSupplierPrice,
      commitCatalog,
      restorePreviousCatalog,
      confirmMatch,
      offerAlternative,
      pickMatch,
      markMissing,
      markMissingMany,
      rejectMatch,
      rejectMatches,
      skipMatchesMany,
      restoreSkipped,
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
