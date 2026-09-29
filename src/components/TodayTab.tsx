import { useRef, useState } from "react";
import { useAppState } from "../hooks/useAppState";
import { plural } from "../utils/format";
import { parseCatalog } from "../utils/mapping";
import { PRICE_ACCEPT, TABLE_ACCEPT, readMatrix } from "../utils/parseFile";
import { normalizePriceFile } from "../utils/priceIntake";
import { supplierKey } from "../utils/text";
import { Button, Field, controlClass } from "./Button";
import { Card, Hint } from "./Card";

interface PriceReport {
  tone: "ok" | "warn";
  lines: string[];
}

export function TodayTab() {
  const { state, commitPrice, commitCatalog } = useAppState();
  const [formOpen, setFormOpen] = useState(true);
  const [supplier, setSupplier] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PriceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"price" | "catalog" | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  async function readPrice() {
    setError(null);
    setInfo(null);
    setReport(null);
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
      const documents = await normalizePriceFile(file, name, state.mappers[supplierKey(name)] ?? null);
      const lines: string[] = [];
      let saved = 0;
      let savedMapper = state.mappers[supplierKey(name)] ?? null;
      for (const result of documents) {
        if (result.status === "ready") {
          commitPrice(
            { file: result.fileName, supplier: name, uploadedAt: new Date().toISOString(), rows: result.rows },
            result.mapper,
          );
          saved += result.rows.length;
          savedMapper = result.mapper;
          lines.push(
            `«${result.fileName}»: ${result.rows.length} ${plural(result.rows.length, "позиция", "позиции", "позиций")}. Распознано: ${result.recognized.join(", ")}.`,
          );
          if (result.ignored.length > 0) lines.push(`Не взяты в рабочие поля: ${result.ignored.join(", ")}.`);
          if (result.warnings.length > 0) lines.push(result.warnings.join(" "));
          continue;
        }
        lines.push(`«${result.fileName}»: ${result.reason}`);
        if (result.recognized.length > 0) lines.push(`Распознано: ${result.recognized.join(", ")}.`);
        if (result.missing.length > 0) lines.push(`Не распознано: ${result.missing.join(", ")}.`);
        if (result.ignored.length > 0) lines.push(`Сомнительные колонки не подставлены: ${result.ignored.join(", ")}.`);
      }
      const ready = documents.some((result) => result.status === "ready");
      setReport({ tone: ready && documents.every((result) => result.status === "ready") ? "ok" : "warn", lines });
      if (saved > 0) {
        setInfo(
          savedMapper
            ? `Сохранено ${saved} ${plural(saved, "позиция", "позиции", "позиций")}. Структура поставщика запомнена и будет проверяться при следующем файле.`
            : `Сохранено ${saved} ${plural(saved, "позиция", "позиции", "позиций")}.`,
        );
        setFile(null);
        if (priceInputRef.current) priceInputRef.current.value = "";
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
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
                accept={PRICE_ACCEPT}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setReport(null);
                }}
              />
            </div>
            <Field label="Имя поставщика">
              <input className={controlClass} value={supplier} onChange={(event) => setSupplier(event.target.value)} />
            </Field>
            <Hint>
              Файл разбирается сам: программа находит таблицу и смысл колонок. Тот же разбор сможет вызвать агент, который заберёт вложение из почты.
            </Hint>
            <Button onClick={() => void readPrice()} disabled={busy !== null}>
              {busy === "price" ? "Читаем файл…" : "Прочитать файл"}
            </Button>
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
