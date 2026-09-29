import { useRef, useState } from "react";
import type { ColumnMapper } from "../types";
import { useAppState } from "../hooks/useAppState";
import { plural } from "../utils/format";
import { columnChoicesOverlap, extractPriceRows, parseCatalog } from "../utils/mapping";
import { TABLE_ACCEPT, readMatrix, readSheets } from "../utils/parseFile";
import { detectionAt, finalizeMapper, ingestPriceSource } from "../utils/priceIntake";
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
    if (!file) {
      setError("Выберите файл прайса.");
      return;
    }
    if (!name) {
      setError("Укажите имя поставщика.");
      return;
    }
    setBusy("price");
    try {
      const sheets = await readSheets(file);
      const result = ingestPriceSource(sheets, name, file.name, state.mappers[supplierKey(name)] ?? null);
      if (result.status === "ready") {
        commitPrice(
          { file: file.name, supplier: name, uploadedAt: new Date().toISOString(), rows: result.rows },
          result.mapper,
        );
        setPending(null);
        setFile(null);
        if (priceInputRef.current) priceInputRef.current.value = "";
        setInfo(
          `Файл «${file.name}» разобран автоматически: ${result.rows.length} ${plural(result.rows.length, "позиция", "позиции", "позиций")}.`,
        );
        return;
      }
      setPending({
        fileName: file.name,
        supplier: name,
        matrix: result.matrix,
        headerRow: Math.max(result.mapper.headerRow, 1),
        mapper: result.mapper,
        supplierCol: -1,
        note: result.reason,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
    }
  }

  function changePendingHeader(value: number) {
    if (!pending || !Number.isInteger(value) || value < 1 || value > pending.matrix.length) return;
    setPending({
      ...pending,
      headerRow: value,
      mapper: detectionAt(pending.matrix, value),
      note: pending.note,
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
      const mapper = finalizeMapper(pending.matrix, { ...pending.mapper, headerRow: pending.headerRow });
      const rows = extractPriceRows(pending.matrix, mapper, pending.supplier, pending.fileName, -1);
      commitPrice(
        { file: pending.fileName, supplier: pending.supplier, uploadedAt: new Date().toISOString(), rows },
        mapper,
      );
      setInfo(`Файл «${pending.fileName}»: ${rows.length} ${plural(rows.length, "позиция", "позиции", "позиций")}. Структура сохранена и будет проверяться при следующей загрузке.`);
      setPending(null);
      setFile(null);
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
            <Field label="Имя поставщика">
              <input className={controlClass} value={supplier} onChange={(event) => setSupplier(event.target.value)} />
            </Field>
            <Hint>
              Колонки, строка заголовков и лист определяются автоматически. Вопрос появится только если прайс требует проверки.
            </Hint>
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
