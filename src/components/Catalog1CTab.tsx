import { useState } from "react";
import { useAppState } from "../hooks/useAppState";
import { CATALOG_FILE_REJECTED, inspectCatalog, type CatalogPreview } from "../utils/catalogUpdate";
import { formatDate, plural } from "../utils/format";
import { TABLE_ACCEPT, readCatalogMatrix } from "../utils/parseFile";
import { Button } from "./Button";
import { Card, Hint } from "./Card";
import { SourceBadge } from "./SourceBadge";

export function Catalog1CTab() {
  const { state, analyzing, commitCatalog, restorePreviousCatalog } = useAppState();
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  const [catalogMatrix, setCatalogMatrix] = useState<string[][] | null>(null);
  const [catalogPreview, setCatalogPreview] = useState<CatalogPreview | null>(null);
  const [catalogRiskAccepted, setCatalogRiskAccepted] = useState(false);
  const [catalogConfirmOpen, setCatalogConfirmOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const catalogCount = state.catalog.length;
  const withBarcode = state.catalog.filter((item) => item.barcode).length;
  const withoutBarcode = catalogCount - withBarcode;

  function resetCatalogDraft() {
    setCatalogFile(null);
    setCatalogMatrix(null);
    setCatalogPreview(null);
    setCatalogRiskAccepted(false);
    setCatalogConfirmOpen(false);
  }

  async function pickCatalogFile(nextFile: File) {
    setError(null);
    setInfo(null);
    resetCatalogDraft();
    setCatalogFile(nextFile);
    setBusy(true);
    try {
      const matrix = await readCatalogMatrix(nextFile);
      setCatalogMatrix(matrix);
    } catch (reason) {
      setCatalogFile(null);
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл");
    } finally {
      setBusy(false);
    }
  }

  function verifyCatalogFile() {
    if (!catalogMatrix || !catalogFile) return;
    setError(null);
    const inspection = inspectCatalog(catalogMatrix, state.catalog, catalogFile.name, state.catalogImportMeta);
    if (!inspection.ok) {
      setError(inspection.reason || CATALOG_FILE_REJECTED);
      setCatalogPreview(null);
      return;
    }
    setCatalogPreview(inspection.preview);
    setCatalogRiskAccepted(false);
  }

  function requestCatalogUpdate() {
    if (!catalogPreview) return;
    if (catalogPreview.shrink === "severe" && !catalogRiskAccepted) return;
    if (catalogPreview.substantialChange) {
      setCatalogConfirmOpen(true);
      return;
    }
    applyCatalogUpdate();
  }

  function applyCatalogUpdate() {
    if (!catalogPreview) return;
    const summary = catalogPreview;
    commitCatalog(catalogPreview);
    resetCatalogDraft();
    setCatalogConfirmOpen(false);
    setInfo(
      `Каталог обновлён: ${summary.found} ${plural(summary.found, "товар", "товара", "товаров")}. Добавлено: ${summary.added}. Обновлено: ${summary.changed}. Без изменений: ${summary.unchanged}. Не найдено в новой выгрузке: ${summary.removed}.`,
    );
  }

  return (
    <div className="space-y-4">
      <Card title="НАША НОМЕНКЛАТУРА ИЗ 1С">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SourceBadge kind="1c" />
          <Hint>Основной каталог товаров компании из 1С. Используется для сопоставления товаров поставщиков с нашей номенклатурой.</Hint>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            Каталог: {catalogCount} {plural(catalogCount, "товар", "товара", "товаров")}
          </p>
          <p>Со штрихкодом: {withBarcode}</p>
          <p>Без штрихкода: {withoutBarcode}</p>
          <p>Последнее обновление: {state.catalogUpdatedAt ? formatDate(state.catalogUpdatedAt) : "ещё не было"}</p>
        </div>
        {state.catalogUpdateSummary ? (
          <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-[#F9FAFB] p-3 text-sm">
            <p className="font-medium">Последнее обновление каталога</p>
            <p>Добавлено: {state.catalogUpdateSummary.added}</p>
            <p>Обновлено: {state.catalogUpdateSummary.changed}</p>
            <p>Без изменений: {state.catalogUpdateSummary.unchanged}</p>
            <p>Не найдено в новой выгрузке: {state.catalogUpdateSummary.removedFromExport}</p>
            <p>Требует проверки: {state.catalogUpdateSummary.needsReview}</p>
          </div>
        ) : null}
      </Card>

      <Card title="Обновить номенклатуру из 1С">
        <Hint>Загрузка выгрузки из 1С. Прайсы поставщиков здесь не меняются.</Hint>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || analyzing} onClick={() => document.getElementById("catalog-1c-file")?.click()}>
            {busy ? "Читаем файл…" : "Выбрать файл"}
          </Button>
          <Button variant="secondary" disabled={!catalogMatrix || busy || analyzing} onClick={verifyCatalogFile}>
            Проверить файл
          </Button>
          {state.previousCatalog.length > 0 ? (
            <Button variant="secondary" disabled={busy || analyzing} onClick={() => setRestoreOpen(true)}>
              Вернуть предыдущую версию
            </Button>
          ) : null}
        </div>
        {catalogFile ? <p className="mt-2 text-sm text-mute">Файл: {catalogFile.name}</p> : null}
        {analyzing ? <p className="mt-3 text-sm text-mute">Анализируем номенклатуру...</p> : null}
        {catalogPreview ? (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <p className="font-medium">Предварительная проверка файла</p>
            <p>Файл: {catalogPreview.fileName || catalogFile?.name || "—"}</p>
            <p className="font-medium">
              Текущий каталог: {catalogCount} {plural(catalogCount, "товар", "товара", "товаров")}. Каталог пока не изменён.
            </p>
            <div>
              <p className="font-medium">Обнаружено:</p>
              <p>— строк в файле: {catalogPreview.rowsInFile}</p>
              <p>— распознано товаров: {catalogPreview.found}</p>
              <p>— со штрихкодом: {catalogPreview.withBarcode}</p>
              <p>— без штрихкода: {catalogPreview.withoutBarcode}</p>
              <p>— уникальных штрихкодов: {catalogPreview.uniqueBarcodes}</p>
              <p>— дубликатов штрихкодов: {catalogPreview.duplicateBarcodes}</p>
              <p>— пустых строк: {catalogPreview.emptyRows}</p>
              <p>— строк, которые программа не смогла распознать: {catalogPreview.skipped}</p>
              <p>— новых товаров: {catalogPreview.added}</p>
              <p>— изменившихся товаров: {catalogPreview.changed}</p>
              <p>— без изменений: {catalogPreview.unchanged}</p>
              <p>— не найдено в новой выгрузке: {catalogPreview.removed}</p>
            </div>
            <div>
              <p className="font-medium">Программа определила:</p>
              <p>Название товара → {catalogPreview.nameHeader}</p>
              <p>Штрихкод → {catalogPreview.barcodeHeader || "не найден"}</p>
              {catalogPreview.codeHeader ? <p>Код → {catalogPreview.codeHeader}</p> : null}
              {catalogPreview.articleHeader ? <p>Артикул → {catalogPreview.articleHeader}</p> : null}
              <p className="text-mute">
                Строка заголовков: {catalogPreview.meta.headerRow || "нет"}. Режим:{" "}
                {catalogPreview.meta.mode === "headers" ? "по заголовкам" : "по содержимому колонок"}.
              </p>
            </div>
            {catalogPreview.warnings.map((line) => (
              <p key={line} className="text-warn">
                {line}
              </p>
            ))}
            {catalogPreview.suspicious ? (
              <div className="rounded-lg border border-[#F0D5D5] bg-[#FDF4F4] p-3 font-medium text-[#9F2D2D]">
                <p>ВНИМАНИЕ.</p>
                <p>
                  Сейчас в каталоге {catalogCount} {plural(catalogCount, "товар", "товара", "товаров")}.
                </p>
                <p>
                  В новом файле обнаружено только {catalogPreview.found} {plural(catalogPreview.found, "товар", "товара", "товаров")}.
                </p>
                <p>Возможно, выбран неправильный файл.</p>
                <p>Текущий каталог пока НЕ изменён.</p>
              </div>
            ) : null}
            {catalogPreview.shrink === "severe" ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={catalogRiskAccepted}
                  onChange={(event) => setCatalogRiskAccepted(event.target.checked)}
                />
                <span>Подтверждаю обновление каталога, хотя товаров в файле намного меньше, чем сейчас.</span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={catalogPreview.shrink === "severe" && !catalogRiskAccepted} onClick={requestCatalogUpdate}>
                Обновить каталог
              </Button>
              <Button variant="secondary" onClick={resetCatalogDraft}>
                Отмена
              </Button>
            </div>
          </div>
        ) : null}
        <input
          id="catalog-1c-file"
          className="hidden"
          type="file"
          accept={TABLE_ACCEPT}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (next) void pickCatalogFile(next);
          }}
        />
      </Card>

      {catalogConfirmOpen && catalogPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="max-w-lg rounded-[10px] bg-white p-5 shadow-card">
            <p className="whitespace-pre-line text-sm text-ink">
              {`Каталог существенно отличается от предыдущей версии.\n\nБыло: ${catalogCount} ${plural(catalogCount, "товар", "товара", "товаров")}\nСтанет не меньше: ${catalogPreview.found} ${plural(catalogPreview.found, "товар", "товара", "товаров")}\n\nДобавится: ${catalogPreview.added}\nОбновится: ${catalogPreview.changed}\nИсчезнет из новой выгрузки: ${catalogPreview.removed}\n\nПродолжить обновление?`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCatalogConfirmOpen(false)}>
                Отмена
              </Button>
              <Button onClick={applyCatalogUpdate}>Да, обновить</Button>
            </div>
          </div>
        </div>
      ) : null}
      {restoreOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="max-w-lg rounded-[10px] bg-white p-5 shadow-card">
            <p className="whitespace-pre-line text-sm text-ink">
              {`Текущий каталог: ${catalogCount} ${plural(catalogCount, "товар", "товара", "товаров")}.\nПредыдущая версия: ${state.previousCatalog.length} ${plural(state.previousCatalog.length, "товар", "товара", "товаров")}.\nВернуть предыдущую версию?`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRestoreOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => {
                  setRestoreOpen(false);
                  resetCatalogDraft();
                  restorePreviousCatalog();
                }}
              >
                Вернуть предыдущую версию
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {info ? <p className="text-sm text-ok">{info}</p> : null}
    </div>
  );
}
