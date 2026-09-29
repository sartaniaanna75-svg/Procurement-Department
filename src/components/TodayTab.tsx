import { useRef, useState } from "react";
import type { ColumnMapper } from "../types";
import { useAppState } from "../hooks/useAppState";
import { plural } from "../utils/format";
import {
  columnChoicesOverlap,
  detectAt,
  extractPriceRows,
  findSupplierCol,
  mapperFits,
  parseCatalog,
  resolveHeader,
} from "../utils/mapping";
import { TABLE_ACCEPT, readMatrix } from "../utils/parseFile";
import { supplierKey } from "../utils/text";
import { Button, Field, controlClass } from "./Button";
import { Card, Hint } from "./Card";
import { MappingForm } from "./MappingForm";

interface PendingPrice {
  fileName: string;
  supplier: string;
  matrix: string[][];
  headerRow: number;
  mapper: ColumnMapper;
  supplierCol: number;
  note: string | null;
}

export function TodayTab() {
  const { state, commitPrice, commitCatalog } = useAppState();
  const [formOpen, setFormOpen] = useState(true);
  const [supplier, setSupplier] = useState("");
  const [headerRow, setHeaderRow] = useState("1");
  const [remap, setRemap] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<PendingPrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"price" | "catalog" | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  async function readPrice() {
    setError(null);
    setInfo(null);
    const name = supplier.trim();
    const rowNumber = Number(headerRow);
    if (!file) {
      setError("Выберите файл прайса.");
      return;
    }
    if (!name) {
      setError("Укажите имя поставщика.");
      return;
    }
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      setError("Строка заголовков должна быть целым числом от 1.");
      return;
    }
    setBusy("price");
    try {
      const matrix = await readMatrix(file);
      if (rowNumber > matrix.length) {
        setError("Строка заголовков выходит за пределы файла.");
        return;
      }
      const saved = state.mappers[supplierKey(name)];
      if (saved && !remap && mapperFits(saved, matrix)) {
        const supplierCol = findSupplierCol(matrix[saved.headerRow - 1] ?? []);
        const rows = extractPriceRows(matrix, saved, name, file.name, supplierCol);
        commitPrice({ file: file.name, supplier: name, uploadedAt: new Date().toISOString(), rows }, saved);
        setPending(null);
        setFile(null);
        if (priceInputRef.current) priceInputRef.current.value = "";
        setInfo(`Файл «${file.name}»: ${rows.length} ${plural(rows.length, "позиция", "позиции", "позиций")}. Формат поставщика уже был известен.`);
        return;
      }
      const detected = resolveHeader(matrix, rowNumber);
      setPending({
        fileName: file.name,
        supplier: name,
        matrix,
        headerRow: detected.headerRow,
        mapper: detected.mapper,
        supplierCol: detected.supplierCol,
        note:
          detected.headerRow === rowNumber
            ? null
            : `В строке ${rowNumber} не нашлись название и цена. Заголовки найдены в строке ${detected.headerRow}.`,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
    }
  }

  function changePendingHeader(value: number) {
    if (!pending || !Number.isInteger(value) || value < 1 || value > pending.matrix.length) return;
    const detected = detectAt(pending.matrix, value);
    setPending({
      ...pending,
      headerRow: value,
      mapper: detected.mapper,
      supplierCol: detected.supplierCol,
      note: null,
    });
  }

  function commitPending() {
    if (!pending) return;
    setError(null);
    if (pending.mapper.name < 0 || pending.mapper.price < 0) {
      setError("Укажите колонки названия и цены.");
      return;
    }
    if (columnChoicesOverlap(pending.mapper)) {
      setError("Каждая колонка выбирается один раз.");
      return;
    }
    try {
      const mapper = { ...pending.mapper, headerRow: pending.headerRow };
      const rows = extractPriceRows(pending.matrix, mapper, pending.supplier, pending.fileName, pending.supplierCol);
      commitPrice(
        { file: pending.fileName, supplier: pending.supplier, uploadedAt: new Date().toISOString(), rows },
        mapper,
      );
      setInfo(`Файл «${pending.fileName}»: ${rows.length} ${plural(rows.length, "позиция", "позиции", "позиций")}. Формат сохранён.`);
      setPending(null);
      setFile(null);
      setRemap(false);
      if (priceInputRef.current) priceInputRef.current.value = "";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить прайс");
    }
  }

  async function readCatalog(nextFile: File) {
    setError(null);
    setInfo(null);
    setBusy("catalog");
    try {
      const matrix = await readMatrix(nextFile);
      const items = parseCatalog(matrix);
      commitCatalog(items);
      setInfo(
        `Каталог обновлён: ${items.length} ${plural(items.length, "товар", "товара", "товаров")}. Сопоставления пересчитаны, ручные решения сохранены.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать каталог");
    } finally {
      setBusy(null);
    }
  }

  const catalogCount = state.catalog.length;

  return (
    <div className="space-y-4">
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
                accept={TABLE_ACCEPT}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPending(null);
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Имя поставщика">
                <input className={controlClass} value={supplier} onChange={(event) => setSupplier(event.target.value)} />
              </Field>
              <Field label="Строка с заголовками">
                <input
                  className={controlClass}
                  type="number"
                  min={1}
                  value={headerRow}
                  onChange={(event) => setHeaderRow(event.target.value)}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-mute">
              <input type="checkbox" checked={remap} onChange={(event) => setRemap(event.target.checked)} />
              Указать колонки заново
            </label>
            <Hint>Файл может быть в любом привычном виде: программа сама найдёт название и цену.</Hint>
            <Button onClick={() => void readPrice()} disabled={busy !== null}>
              {busy === "price" ? "Читаем файл…" : "Прочитать файл"}
            </Button>
            {pending ? (
              <MappingForm
                fileName={pending.fileName}
                supplier={pending.supplier}
                matrix={pending.matrix}
                headerRow={pending.headerRow}
                mapper={pending.mapper}
                note={pending.note}
                onHeaderRow={changePendingHeader}
                onMapper={(mapper) => setPending({ ...pending, mapper })}
                onSubmit={commitPending}
                onCancel={() => setPending(null)}
              />
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="Каталог товаров">
        <p className="mb-3 text-sm font-medium">
          {catalogCount > 0
            ? `В каталоге ${catalogCount} ${plural(catalogCount, "товар", "товара", "товаров")}`
            : "Каталог ещё не загружен"}
        </p>
        <Hint>Список товаров из 1С. Его загружают один раз, сопоставления остаются.</Hint>
        {catalogCount === 0 ? (
          <div className="mt-3">
            <p className="mb-2 text-sm font-medium">Файл каталога, Excel или CSV: Код, Название, Единица</p>
            <Button variant="secondary" disabled={busy !== null} onClick={() => document.getElementById("catalog-file")?.click()}>
              {busy === "catalog" ? "Читаем каталог…" : "Загрузить номенклатуру из 1С"}
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            <Button variant="secondary" disabled={busy !== null} onClick={() => document.getElementById("catalog-file")?.click()}>
              {busy === "catalog" ? "Читаем каталог…" : "Обновить номенклатуру из 1С"}
            </Button>
          </div>
        )}
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

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {info ? <p className="text-sm text-ok">{info}</p> : null}
      <Hint>Все данные хранятся в этом браузере и сохраняются после каждого действия.</Hint>
    </div>
  );
}
