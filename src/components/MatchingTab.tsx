import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../hooks/useAppState";
import { useShowMore } from "../hooks/useShowMore";
import type { MatchFilter } from "../types";
import { EMPTY_MATCH } from "../types";
import { passesFilter, statusLabel, statusRowClass } from "../utils/format";
import { catalogMap, listRows, ourNomenclature, summarizeSuppliers } from "../utils/rows";
import { matchesQuery } from "../utils/search";
import { unitsConflict } from "../utils/units";
import { Button, Field, FilterBar, controlClass } from "./Button";
import { Card, Hint } from "./Card";
import { CatalogPicker } from "./CatalogPicker";

const filters: Array<{ id: MatchFilter; label: string }> = [
  { id: "need", label: "Нужно решить" },
  { id: "confirmed", label: "Подтверждено" },
  { id: "missing", label: "Отсутствует" },
  { id: "resolved", label: "Всё решено" },
];

interface PickerState {
  key: string;
  top: number;
  left: number;
}

export function MatchingTab() {
  const { state, notice, clearNotice, confirmMatch, offerAlternative, pickMatch, markMissing } = useAppState();
  const [supplier, setSupplier] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MatchFilter>("need");
  const [picker, setPicker] = useState<PickerState | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const catalog = useMemo(() => catalogMap(state.catalog), [state.catalog]);
  const suppliers = useMemo(() => summarizeSuppliers(state.uploads), [state.uploads]);
  const rows = useMemo(() => listRows(state.uploads), [state.uploads]);
  const scoped = useMemo(
    () => (supplier ? rows.filter((row) => row.supplier === supplier) : rows),
    [rows, supplier],
  );
  const needCount = scoped.filter((row) => (state.matches[row.key] ?? EMPTY_MATCH).status === "need").length;
  const confirmedCount = scoped.filter((row) => {
    const status = (state.matches[row.key] ?? EMPTY_MATCH).status;
    return status === "confirmed" || status === "picked";
  }).length;
  const filtered = useMemo(
    () =>
      scoped.filter((row) => {
        const match = state.matches[row.key] ?? EMPTY_MATCH;
        if (!passesFilter(match.status, filter)) return false;
        return matchesQuery([row.name, ourNomenclature(match.code, catalog), row.code, row.barcode], query);
      }),
    [scoped, state.matches, filter, query, catalog],
  );
  const pager = useShowMore(`${supplier}|${filter}|${query}`);
  const visible = filtered.slice(0, pager.count);

  function openPicker(key: string, anchor: HTMLButtonElement) {
    const rect = anchor.getBoundingClientRect();
    const width = 360;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = rect.bottom + 4;
    if (top + 420 > window.innerHeight - 8) top = Math.max(8, rect.top - 424);
    setPicker({ key, top, left });
  }

  if (rows.length === 0) {
    return (
      <Card title="Сопоставление">
        <Hint>
          Сначала загрузите прайс на <Link className="text-brand underline" to="/">вкладке «Сегодня»</Link>.
        </Hint>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <Field label="Поставщик">
            <select className={controlClass} value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              <option value="">Все поставщики</option>
              {suppliers.map((item) => (
                <option key={item.supplier} value={item.supplier}>
                  {item.supplier}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-[360px] max-w-full">
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
      <p className="text-sm text-mute">
        {needCount} нужно решить, {confirmedCount} подтверждено
      </p>
      {state.catalog.length === 0 ? (
        <Hint>Загрузите номенклатуру из 1С на вкладке «Сегодня», чтобы появились предложения.</Hint>
      ) : null}
      {notice ? (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-green-50 text-ok" : "bg-amber-50 text-warn"}`}>
          <span>{notice.text}</span>
          <Button variant="quiet" onClick={clearNotice}>
            Скрыть
          </Button>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <Card title="Номенклатура">
          <Hint>Нет товаров в этом фильтре.</Hint>
        </Card>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[10px] border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr>
                {["Номенклатура поставщика", "Поставщик", "Предлагаемая наша номенклатура", "Уверенность", "Почему", "Статус", "Действие"].map(
                  (title) => (
                    <th
                      key={title}
                      className="sticky top-0 z-10 bg-white px-3 py-2 text-left align-top text-xs font-semibold text-brand shadow-[inset_0_-1px_0_#E5E7EB]"
                    >
                      {title}
                    </th>
                  ),
                )}
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
                    <td className="break-words px-3 py-2 align-top">{row.name}</td>
                    <td className="break-words px-3 py-2 align-top">{row.supplier}</td>
                    <td className="break-words px-3 py-2 align-top">{ourNomenclature(match.code, catalog)}</td>
                    <td className="break-words px-3 py-2 align-top">{match.confidence > 0 ? `${match.confidence}%` : "—"}</td>
                    <td className="break-words px-3 py-2 align-top">{match.reason || "—"}</td>
                    <td className="break-words px-3 py-2 align-top">{label}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        <Button variant="yes" disabled={!match.code || match.status === "confirmed"} onClick={() => confirmMatch(row.key)}>
                          Да
                        </Button>
                        <Button variant="alt" disabled={!match.code} onClick={() => offerAlternative(row.key)}>
                          Альтернатива
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={state.catalog.length === 0}
                          onClick={(event) => openPicker(row.key, event.currentTarget)}
                        >
                          Выбрать...
                        </Button>
                        <Button variant="ghost" disabled={match.status === "missing"} onClick={() => markMissing(row.key)}>
                          Нет в каталоге
                        </Button>
                      </div>
                    </td>
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
      {picker ? (
        <CatalogPicker
          catalog={state.catalog}
          top={picker.top}
          left={picker.left}
          onClose={closePicker}
          onSelect={(item) => {
            pickMatch(picker.key, item.code);
            closePicker();
          }}
        />
      ) : null}
    </div>
  );
}
