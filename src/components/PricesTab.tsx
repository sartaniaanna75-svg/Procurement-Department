import { useMemo, useState } from "react";
import { useAppState } from "../hooks/useAppState";
import { useShowMore } from "../hooks/useShowMore";
import type { PriceFilter } from "../types";
import { EMPTY_MATCH } from "../types";
import { formatDate, formatPrice, passesFilter, plural, statusLabel, statusRowClass } from "../utils/format";
import { catalogMap, listRows, matchKey, ourNomenclature, summarizeSuppliers } from "../utils/rows";
import { matchesQuery } from "../utils/search";
import { unitsConflict } from "../utils/units";
import { Button, Field, FilterBar, controlClass } from "./Button";
import { Card, Hint } from "./Card";
import { SourcedName } from "./SourceBadge";

const filters: Array<{ id: PriceFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "need", label: "Нужно решить" },
  { id: "confirmed", label: "Подтверждено" },
  { id: "missing", label: "Отсутствует" },
];

export function PricesTab() {
  const { state } = useAppState();
  const [supplier, setSupplier] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PriceFilter>("all");
  const summaries = useMemo(() => summarizeSuppliers(state.uploads), [state.uploads]);
  const catalog = useMemo(() => catalogMap(state.catalog), [state.catalog]);
  const rows = useMemo(
    () => (supplier ? listRows(state.uploads).filter((row) => row.supplier === supplier) : []),
    [state.uploads, supplier],
  );
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const match = state.matches[row.key] ?? EMPTY_MATCH;
        if (!passesFilter(match.status, filter)) return false;
        const ours = ourNomenclature(match.code, catalog);
        return matchesQuery([row.name, row.code, row.barcode, row.unit, row.supplier, ours, String(row.price)], query);
      }),
    [rows, state.matches, filter, query, catalog],
  );
  const pager = useShowMore(`${supplier ?? ""}|${filter}|${query}`);
  const visible = filtered.slice(0, pager.count);

  if (!supplier) {
    return (
      <Card title="Сводка по поставщикам">
        <Hint>Только прайсы поставщиков. Наша номенклатура 1С здесь не отображается.</Hint>
        {summaries.length === 0 ? (
          <Hint>Прайсы ещё не загружены. Добавьте файл на вкладке «Сегодня».</Hint>
        ) : (
          <div className="divide-y divide-slate-100">
            {summaries.map((item) => (
              <div key={item.supplier} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-medium">{item.supplier}</div>
                  <div className="text-sm text-mute">
                    {item.count} {plural(item.count, "товар", "товара", "товаров")} · {formatDate(item.uploadedAt)}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => setSupplier(item.supplier)}>
                  Показать прайс
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand">{supplier}</h2>
          <Hint>
            {filtered.length} {plural(filtered.length, "строка", "строки", "строк")}
          </Hint>
        </div>
        <Button variant="quiet" onClick={() => setSupplier(null)}>
          К поставщикам
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Field label="Поиск">
            <input
              className={controlClass}
              value={query}
              placeholder="Поиск по названию"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        </div>
        <FilterBar value={filter} options={filters} onChange={setFilter} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-amber-50 px-2 py-1">Нужно решить</span>
        <span className="rounded bg-green-50 px-2 py-1">Подтверждено</span>
        <span className="rounded bg-red-50 px-2 py-1">Конфликт или отсутствует</span>
      </div>
      {visible.length === 0 ? (
        <Card title="Прайс">
          <Hint>Нет строк с таким поиском и фильтром.</Hint>
        </Card>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[10px] border border-slate-200 bg-white shadow-card">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "8%" }} />
            </colgroup>
            <thead>
              <tr>
                {["Товар поставщика", "Цена", "Наша номенклатура 1С", "Состояние"].map((title) => (
                  <th
                    key={title}
                    className="sticky top-0 z-10 bg-white px-3 py-2 text-left align-top text-xs font-semibold text-brand shadow-[inset_0_-1px_0_#E5E7EB]"
                  >
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const match = state.matches[row.key] ?? EMPTY_MATCH;
                const item = match.code ? catalog.get(match.code) : undefined;
                const conflict = Boolean(item && unitsConflict(row.unit, item.unit));
                const label = conflict && match.status === "need" ? "Конфликт единицы" : statusLabel(match.status);
                return (
                  <tr key={row.key} className={`border-b border-black/5 ${statusRowClass(match.status, conflict)}`}>
                    <td className="break-words px-3 py-2 align-top">
                      <div>
                        <SourcedName kind="supplier">{row.name}</SourcedName>
                      </div>
                      {row.code || row.barcode ? (
                        <div className="mt-1 text-xs text-mute">
                          {[row.code && `код ${row.code}`, row.barcode && `штрихкод ${row.barcode}`].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="break-words px-3 py-2 align-top tabular-nums">
                      {formatPrice(row.price)} ₽{row.unit ? ` / ${row.unit}` : ""}
                    </td>
                    <td className="break-words px-3 py-2 align-top">
                      {match.code ? (
                        <SourcedName kind="1c">{ourNomenclature(match.code, catalog)}</SourcedName>
                      ) : (
                        ourNomenclature(match.code, catalog)
                      )}
                    </td>
                    <td className="break-words px-3 py-2 align-top">{label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pager.count < filtered.length ? (
        <Button variant="secondary" onClick={pager.showMore}>
          Показать ещё
        </Button>
      ) : null}
      {filtered.length > 0 ? (
        <Hint>
          Показано {Math.min(pager.count, filtered.length)} из {filtered.length}
        </Hint>
      ) : null}
      <MissingFromPrice supplier={supplier} />
    </div>
  );
}

function MissingFromPrice({ supplier }: { supplier: string }) {
  const { state } = useAppState();
  const card = state.suppliers.find((item) => item.name === supplier);
  const items = card ? state.notInPrice[card.id] ?? [] : [];
  if (items.length === 0) return null;
  const catalog = catalogMap(state.catalog);
  return (
    <Card title="Нет в текущем прайсе">
      <Hint>Эти товары были в прошлом прайсе. Остаток не обнуляется, сопоставление сохранено.</Hint>
      <div className="mt-3 divide-y divide-slate-100">
        {items.slice(0, 30).map((item) => {
          const key = matchKey(supplier, item.name, item.code, item.barcode, item.unit);
          const match = state.matches[key] ?? EMPTY_MATCH;
          return (
            <div key={key} className="py-2 text-sm">
              <div>{item.name}</div>
              <div className="text-xs text-mute">
                Нет в текущем прайсе
                {match.code ? ` · ${ourNomenclature(match.code, catalog)}` : ""}
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 30 ? <Hint>Показаны первые 30 из {items.length}.</Hint> : null}
    </Card>
  );
}
