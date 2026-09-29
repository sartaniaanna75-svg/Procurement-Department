import { useRef, useState } from "react";
import { useAppState } from "../hooks/useAppState";
import type { SupplierCard } from "../types";
import { CATALOG_FILE_REJECTED, inspectCatalog, type CatalogPreview } from "../utils/catalogUpdate";
import { formatDate, plural } from "../utils/format";
import { PRICE_ACCEPT, TABLE_ACCEPT, loadPriceFiles, readCatalogMatrix, type LoadedPriceFile } from "../utils/parseFile";
import type { AcceptedPrice } from "../utils/procurement";
import { acceptPriceColumn, normalizeLoadedPrice, type NormalizedPriceDocument } from "../utils/priceSkill";
import { collectSignals, createSupplier, detectSupplier, type SupplierSignals } from "../utils/suppliers";
import { supplierKey } from "../utils/text";
import { Button, Field, controlClass } from "./Button";
import { Card, Hint } from "./Card";
import { ProcurementPanel } from "./ProcurementPanel";

interface PriceReport {
  tone: "ok" | "warn";
  lines: string[];
}

interface PendingPrice {
  loaded: LoadedPriceFile[];
  signals: SupplierSignals;
  supplierId: string;
  newName: string;
  confidence: "medium" | "low";
}

interface SavedPrice {
  supplierId: string;
  auto: boolean;
  inputs: AcceptedPrice[];
}

export function TodayTab() {
  const { state, analyzing, acceptSupplierPrices, correctSupplierPrice, commitCatalog, restorePreviousCatalog } = useAppState();
  const [formOpen, setFormOpen] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PriceReport | null>(null);
  const [choice, setChoice] = useState<NormalizedPriceDocument | null>(null);
  const [pending, setPending] = useState<PendingPrice | null>(null);
  const [signals, setSignals] = useState<SupplierSignals | null>(null);
  const [saved, setSaved] = useState<SavedPrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"price" | "catalog" | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  function supplierName(id: string): string {
    return state.suppliers.find((card) => card.id === id)?.name ?? "";
  }

  function publish(supplierId: string, loaded: LoadedPriceFile[], signals: SupplierSignals, auto: boolean, card?: SupplierCard) {
    const name = card?.name ?? supplierName(supplierId);
    setSignals(signals);
    const documents = normalizeLoadedPrice(loaded, name, state.mappers[supplierKey(name)] ?? null);
    const lines: string[] = [];
    const inputs: AcceptedPrice[] = [];
    const receivedAt = new Date().toISOString();
    let question: NormalizedPriceDocument | null = null;
    for (const result of documents) {
      if (result.status === "ready") {
        inputs.push({ supplierId, fileName: result.fileName, receivedAt, rows: result.rows, mapper: result.mapper, signals });
        lines.push(`«${result.fileName}»: ${result.rows.length} ${plural(result.rows.length, "позиция", "позиции", "позиций")}. Распознано: ${result.recognized.join(", ")}.`);
        if (result.ignored.length > 0) lines.push(`Не взяты в рабочие поля: ${result.ignored.join(", ")}.`);
        if (result.warnings.length > 0) lines.push(result.warnings.join(" "));
        continue;
      }
      if (result.question && !question) question = result;
      lines.push(`«${result.fileName}»: ${result.reason}`);
      if (result.recognized.length > 0) lines.push(`Распознано: ${result.recognized.join(", ")}.`);
      if (result.missing.length > 0) lines.push(`Не распознано: ${result.missing.join(", ")}.`);
    }
    if (inputs.length === 0) {
      setReport({ tone: "warn", lines });
      setChoice(question);
      setSaved(null);
      return;
    }
    const outcome = acceptSupplierPrices(inputs, card);
    setReport({ tone: outcome.ok ? "ok" : "warn", lines });
    setChoice(question);
    if (!outcome.ok) {
      setError(outcome.reason);
      setSaved(null);
      return;
    }
    setSaved({ supplierId, auto, inputs });
    setPending(null);
    setInfo(outcome.reason);
    setFile(null);
    if (priceInputRef.current) priceInputRef.current.value = "";
  }

  async function readPrice() {
    setError(null);
    setInfo(null);
    setReport(null);
    setChoice(null);
    setPending(null);
    setSaved(null);
    if (!file) {
      setError("Выберите файл прайса.");
      return;
    }
    setBusy("price");
    try {
      const loaded = await loadPriceFiles(file);
      const signals = collectSignals(file.name, loaded);
      const guess = detectSupplier(signals, state.suppliers, state.mappers);
      if (guess.confidence === "high" && guess.supplierId) {
        publish(guess.supplierId, loaded, signals, true);
        return;
      }
      setPending({
        loaded,
        signals,
        supplierId: guess.supplierId ?? "",
        newName: "",
        confidence: guess.confidence === "medium" ? "medium" : "low",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
    }
  }

  function confirmPending() {
    if (!pending) return;
    setError(null);
    const existing = state.suppliers.find((card) => card.id === pending.supplierId);
    if (existing) {
      publish(existing.id, pending.loaded, pending.signals, false);
      return;
    }
    const name = pending.newName.trim();
    if (!name) {
      setError("Выберите поставщика или укажите его один раз.");
      return;
    }
    const card = createSupplier(name);
    publish(card.id, pending.loaded, pending.signals, false, card);
  }

  const [catalogPreview, setCatalogPreview] = useState<CatalogPreview | null>(null);
  const [catalogRiskAccepted, setCatalogRiskAccepted] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  async function readCatalog(nextFile: File) {
    setError(null);
    setInfo(null);
    setCatalogPreview(null);
    setCatalogRiskAccepted(false);
    setBusy("catalog");
    try {
      const matrix = await readCatalogMatrix(nextFile);
      const inspection = inspectCatalog(matrix, state.catalog);
      if (!inspection.ok) {
        setError(inspection.reason || CATALOG_FILE_REJECTED);
        return;
      }
      setCatalogPreview(inspection.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать каталог");
    } finally {
      setBusy(null);
    }
  }

  function confirmCatalog() {
    if (!catalogPreview) return;
    if (catalogPreview.shrink === "severe" && !catalogRiskAccepted) return;
    const count = catalogPreview.found;
    commitCatalog(catalogPreview.items);
    setCatalogPreview(null);
    setCatalogRiskAccepted(false);
    setInfo(`Каталог обновлён: ${count} ${plural(count, "товар", "товара", "товаров")}. Прежние решения по товарам поставщиков сохранены.`);
  }

  const catalogCount = state.catalog.length;
  const known = saved ? state.suppliers.find((card) => card.id === saved.supplierId) : undefined;

  return (
    <div className="space-y-4">
      <ProcurementPanel />
      <Card title="Прайс поставщика">
        <Button variant="secondary" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? "Скрыть форму" : "Загрузить прайс вручную"}
        </Button>
        {formOpen ? (
          <div className="mt-4 space-y-3">
            <div className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Файл прайса</span>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => priceInputRef.current?.click()}>
                  Выбрать файл
                </Button>
                <span className="text-sm text-mute">{file ? file.name : "Файл не выбран"}</span>
              </div>
              <input
                ref={priceInputRef}
                className="hidden"
                type="file"
                accept={PRICE_ACCEPT}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setReport(null);
                  setPending(null);
                }}
              />
            </div>
            <Hint>Программа сама определяет поставщика и колонки. Имя поставщика спрашивается один раз, если он ещё не знаком.</Hint>
            <Button onClick={() => void readPrice()} disabled={busy !== null}>
              {busy === "price" ? "Читаем файл…" : "Прочитать файл"}
            </Button>
            {pending ? (
              <div className="space-y-2 text-sm">
                <p>
                  {pending.confidence === "medium" && pending.supplierId
                    ? `Похоже, это ${supplierName(pending.supplierId)}. Подтвердите поставщика.`
                    : "Поставщик по файлу не определён. Выберите его один раз."}
                </p>
                <Field label="Поставщик">
                  <select
                    className={controlClass}
                    value={pending.supplierId}
                    onChange={(event) => setPending({ ...pending, supplierId: event.target.value })}
                  >
                    <option value="">Новый поставщик</option>
                    {state.suppliers.map((card) => (
                      <option key={card.id} value={card.id}>{card.name}</option>
                    ))}
                  </select>
                </Field>
                {pending.supplierId ? null : (
                  <Field label="Название нового поставщика">
                    <input className={controlClass} value={pending.newName} onChange={(event) => setPending({ ...pending, newName: event.target.value })} />
                  </Field>
                )}
                <Button onClick={confirmPending}>Подтвердить поставщика</Button>
              </div>
            ) : null}
            {saved && known ? (
              <div className="space-y-2 text-sm">
                <p className="text-ok">
                  Поставщик: {known.name}
                  {saved.auto ? " — определён автоматически" : ""}
                </p>
                <Field label="Изменить поставщика, если программа ошиблась">
                  <select
                    className={controlClass}
                    value={saved.supplierId}
                    onChange={(event) => {
                      const supplierId = event.target.value;
                      if (!supplierId || supplierId === saved.supplierId) return;
                      const outcome = correctSupplierPrice(saved.inputs.map((input) => ({ ...input, supplierId })));
                      if (!outcome.ok) {
                        setError(outcome.reason);
                        return;
                      }
                      setSaved({ ...saved, supplierId, auto: false });
                      setInfo(outcome.reason);
                    }}
                  >
                    {state.suppliers.map((card) => (
                      <option key={card.id} value={card.id}>{card.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
            {choice?.question ? (
              <div className="space-y-2 text-sm">
                <p>{choice.question.prompt}</p>
                <div className="flex flex-wrap gap-2">
                  {choice.question.options.map((option) => (
                    <Button
                      key={option.column}
                      variant="secondary"
                      onClick={() => {
                        const owner = known ?? state.suppliers.find((card) => card.id === pending?.supplierId);
                        if (!owner) {
                          setError("Сначала подтвердите поставщика.");
                          return;
                        }
                        const picked = acceptPriceColumn(choice, option.column, owner.name, choice.fileName);
                        if (picked.status !== "ready") {
                          setError(picked.reason);
                          return;
                        }
                        const receivedAt = new Date().toISOString();
                        const input: AcceptedPrice = {
                          supplierId: owner.id,
                          fileName: choice.fileName,
                          receivedAt,
                          rows: picked.rows,
                          mapper: picked.mapper,
                          signals: signals ?? undefined,
                        };
                        const outcome = acceptSupplierPrices([input]);
                        if (!outcome.ok) {
                          setError(outcome.reason);
                          return;
                        }
                        setSaved({ supplierId: owner.id, auto: false, inputs: [input] });
                        setInfo(`Выбрана цена «${option.label}». ${outcome.reason}`);
                        setChoice(null);
                        setFile(null);
                        if (priceInputRef.current) priceInputRef.current.value = "";
                      }}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {report ? (
              <div className={`space-y-1 text-sm ${report.tone === "ok" ? "text-ok" : "text-ink"}`}>
                {report.lines.map((line, index) => (
                  <p key={`${index}-${line}`}>{line}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="Каталог товаров">
        <div className="space-y-1 text-sm">
          <p className="font-medium">Каталог: {catalogCount} {plural(catalogCount, "товар", "товара", "товаров")}</p>
          <p>Со штрихкодом: {state.catalog.filter((item) => item.barcode).length}</p>
          <p>Без штрихкода: {state.catalog.filter((item) => !item.barcode).length}</p>
          <p>Последнее обновление: {state.catalogUpdatedAt ? formatDate(state.catalogUpdatedAt) : "ещё не было"}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy !== null || analyzing} onClick={() => document.getElementById("catalog-file")?.click()}>
            {busy === "catalog" ? "Читаем каталог…" : "Обновить номенклатуру из 1С"}
          </Button>
          {state.previousCatalog.length > 0 ? (
            <Button variant="secondary" disabled={busy !== null || analyzing} onClick={() => setRestoreOpen(true)}>
              Вернуть предыдущую версию
            </Button>
          ) : null}
        </div>
        {analyzing ? <p className="mt-3 text-sm text-mute">Анализируем номенклатуру...</p> : null}
        {catalogPreview ? (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <p className="font-medium">Текущий каталог: {catalogCount} {plural(catalogCount, "товар", "товара", "товаров")}</p>
            <div>
              <p>В новом файле:</p>
              <p>— найдено товаров: {catalogPreview.found}</p>
              <p>— со штрихкодом: {catalogPreview.withBarcode}</p>
              <p>— без штрихкода: {catalogPreview.withoutBarcode}</p>
              <p>— новых товаров: {catalogPreview.added}</p>
              <p>— изменившихся товаров: {catalogPreview.changed}</p>
              <p>— не найдено в новой выгрузке: {catalogPreview.removed}</p>
            </div>
            <p className="text-mute">
              Колонка наименования: «{catalogPreview.nameHeader}». Колонка штрихкода: «{catalogPreview.barcodeHeader}».
              {catalogPreview.codeHeader ? ` Колонка кода: «${catalogPreview.codeHeader}».` : ""} Строка заголовков: {catalogPreview.headerRow}. Прочитано строк: {catalogPreview.dataRows}. Отброшено: {catalogPreview.skipped}.
            </p>
            {catalogPreview.shrink !== "none" ? (
              <div className="rounded-lg border border-[#F0D5D5] bg-[#FDF4F4] p-3 font-medium text-[#9F2D2D]">
                <p>Внимание.</p>
                <p>Сейчас в каталоге {catalogCount} {plural(catalogCount, "товар", "товара", "товаров")}.</p>
                <p>В новом файле найдено только {catalogPreview.found} {plural(catalogPreview.found, "товар", "товара", "товаров")}.</p>
                <p>Возможно, выбран неправильный файл.</p>
              </div>
            ) : null}
            {catalogPreview.shrink === "severe" ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={catalogRiskAccepted} onChange={(event) => setCatalogRiskAccepted(event.target.checked)} />
                <span>Подтверждаю замену каталога, хотя товаров станет намного меньше.</span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={catalogPreview.shrink === "severe" && !catalogRiskAccepted} onClick={confirmCatalog}>
                Подтвердить обновление
              </Button>
              <Button variant="secondary" onClick={() => { setCatalogPreview(null); setCatalogRiskAccepted(false); }}>
                Отменить
              </Button>
            </div>
          </div>
        ) : null}
        <input
          id="catalog-file"
          className="hidden"
          type="file"
          accept={TABLE_ACCEPT}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (next) void readCatalog(next);
          }}
        />
      </Card>
      {restoreOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="max-w-lg rounded-[10px] bg-white p-5 shadow-card">
            <p className="whitespace-pre-line text-sm text-ink">
              {`Текущий каталог: ${catalogCount} ${plural(catalogCount, "товар", "товара", "товаров")}.\nПредыдущая версия: ${state.previousCatalog.length} ${plural(state.previousCatalog.length, "товар", "товара", "товаров")}.\nВернуть предыдущую версию?`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRestoreOpen(false)}>Отмена</Button>
              <Button onClick={() => { setRestoreOpen(false); setCatalogPreview(null); restorePreviousCatalog(); }}>Вернуть предыдущую версию</Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {info ? <p className="text-sm text-ok">{info}</p> : null}
      <Hint>Все данные хранятся в этом браузере и сохраняются после каждого действия.</Hint>
    </div>
  );
}
