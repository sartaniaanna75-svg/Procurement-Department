import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../hooks/useAppState";
import { useShowMore } from "../hooks/useShowMore";
import type { MatchFilter, MatchStatus } from "../types";
import { EMPTY_MATCH } from "../types";
import { confidenceClass, confidenceLabel, passesFilter, plural, statusLabel, statusRowClass } from "../utils/format";
import { catalogMap, listRows, ourNomenclature, summarizeSuppliers } from "../utils/rows";
import { matchesQuery } from "../utils/search";
import { unitsConflict } from "../utils/units";
import { Button, Field, FilterBar, controlClass } from "./Button";
import { Card, Hint } from "./Card";
import { CatalogPicker } from "./CatalogPicker";

interface PickerState {
  key: string;
  top: number;
  left: number;
}

interface PendingBulk {
  kind: "reject";
  keys: string[];
}

const OPEN_STATUS = new Set<MatchStatus>(["need", "review", "skipped", "missing"]);

const headCell = "sticky top-0 z-10 bg-white px-2 py-1.5 text-left align-middle text-xs font-semibold text-brand shadow-[inset_0_-1px_0_#E5E7EB]";
const bodyCell = "px-2 py-1.5 align-middle text-sm";

function ClampText({ text }: { text: string }) {
  const value = text || "—";
  return (
    <span className="line-clamp-2 w-full leading-snug" title={value}>
      {value}
    </span>
  );
}

export function MatchingTab() {
  const {
    state,
    analyzing,
    notice,
    clearNotice,
    confirmMatch,
    confirmMatchesMany,
    pickMatch,
    rejectMatch,
    rejectMatches,
    releaseMatch,
  } = useAppState();
  const [supplier, setSupplier] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MatchFilter>("need");
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const anchorRef = useRef(-1);
  const closePicker = useCallback(() => setPicker(null), []);
  const catalog = useMemo(() => catalogMap(state.catalog), [state.catalog]);
  const suppliers = useMemo(() => summarizeSuppliers(state.uploads), [state.uploads]);
  const rows = useMemo(() => listRows(state.uploads), [state.uploads]);
  const scoped = useMemo(
    () => (supplier ? rows.filter((row) => row.supplier === supplier) : rows),
    [rows, supplier],
  );
  const rejectedMemory = useMemo(
    () =>
      Object.values(state.productMemory)
        .filter((item) => item.verdict === "rejected")
        .filter((item) => (supplier ? item.supplier === supplier : true))
        .sort((a, b) => a.traits.name.localeCompare(b.traits.name, "ru") || a.supplier.localeCompare(b.supplier, "ru")),
    [state.productMemory, supplier],
  );
  const rejectedVisible = rejectedMemory.filter((item) => matchesQuery([item.traits.name, item.supplier, item.traits.barcode, item.traits.kind], query));
  const counts = useMemo(() => {
    const tally = { need: 0, review: 0, confirmed: 0, rejected: 0, open: 0, resolved: 0 };
    for (const row of scoped) {
      const match = state.matches[row.key] ?? EMPTY_MATCH;
      if (match.relation === "alternative") continue;
      if (match.status === "confirmed" || match.status === "picked") {
        tally.confirmed += 1;
        tally.resolved += 1;
      } else if (match.status === "rejected") {
        tally.rejected += 1;
        tally.resolved += 1;
      } else if (match.status === "review") {
        tally.review += 1;
        tally.open += 1;
      } else {
        // need / skipped / missing — всё ещё требует решения в новом интерфейсе
        tally.need += 1;
        tally.open += 1;
      }
    }
    return tally;
  }, [scoped, state.matches]);
  const filters = useMemo(
    () => [
      { id: "need" as const, label: `Нужно решить — ${counts.need}` },
      { id: "review" as const, label: `На проверке — ${counts.review}` },
      { id: "confirmed" as const, label: `Подтверждено — ${counts.confirmed}` },
      { id: "rejected" as const, label: `Не работаем — ${counts.rejected}` },
      { id: "resolved" as const, label: "Всё решено" },
    ],
    [counts],
  );
  const filtered = useMemo(
    () =>
      scoped.filter((row) => {
        const match = state.matches[row.key] ?? EMPTY_MATCH;
        if (!passesFilter(match.status, filter, match.relation ?? "exact")) return false;
        return matchesQuery([row.name, ourNomenclature(match.code, catalog), row.code, row.barcode], query);
      }),
    [scoped, state.matches, filter, query, catalog],
  );
  const filteredKeys = useMemo(() => filtered.map((row) => row.key), [filtered]);
  const chosenKeys = filteredKeys.filter((key) => selected.has(key));
  const openKeys = chosenKeys.filter((key) => OPEN_STATUS.has((state.matches[key] ?? EMPTY_MATCH).status));
  const confirmableKeys = chosenKeys.filter((key) => {
    const match = state.matches[key] ?? EMPTY_MATCH;
    return Boolean(match.code) && OPEN_STATUS.has(match.status);
  });
  const allChecked = filteredKeys.length > 0 && filteredKeys.every((key) => selected.has(key));
  const someChecked = chosenKeys.length > 0 && !allChecked;
  const pager = useShowMore(`${supplier}|${filter}|${query}`);
  const visible = filtered.slice(0, pager.count);
  const remaining = counts.open;
  const priceDone = scoped.length > 0 && remaining === 0;

  useEffect(() => {
    setSelected(new Set());
    setPending(null);
    anchorRef.current = -1;
  }, [supplier, query, filter]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (filter === "rejected") return;
      event.preventDefault();
      setSelected((current) => {
        const allOn = filteredKeys.length > 0 && filteredKeys.every((key) => current.has(key));
        return allOn ? new Set() : new Set(filteredKeys);
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredKeys, filter]);

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(filteredKeys));
    anchorRef.current = allChecked ? -1 : 0;
  }

  function toggleOne(key: string) {
    anchorRef.current = filteredKeys.indexOf(key);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectRow(key: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    const index = filteredKeys.indexOf(key);
    if (index < 0) return;
    if (event.shiftKey && anchorRef.current >= 0) {
      const start = Math.min(anchorRef.current, index);
      const end = Math.max(anchorRef.current, index);
      setSelected(new Set(filteredKeys.slice(start, end + 1)));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      anchorRef.current = index;
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    anchorRef.current = index;
    setSelected(new Set([key]));
  }

  function openPicker(key: string, anchor: HTMLButtonElement) {
    const rect = anchor.getBoundingClientRect();
    const width = 360;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = rect.bottom + 4;
    if (top + 420 > window.innerHeight - 8) top = Math.max(8, rect.top - 424);
    setPicker({ key, top, left });
  }

  function applyPending() {
    if (!pending) return;
    rejectMatches(pending.keys);
    setSelected(new Set());
    setPending(null);
  }

  if (rows.length === 0 && rejectedMemory.length === 0) {
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
      <Hint>
        Здесь встречаются две базы: товар поставщика ↔ наша номенклатура 1С. Прайсы загружаются на «Сегодня», каталог 1С — на вкладке «Номенклатура 1С».
      </Hint>
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
              placeholder="Название или штрихкод"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        </div>
        <FilterBar value={filter} options={filters} onChange={setFilter} />
      </div>
      <p className="text-sm text-ink">
        <span className="block font-medium">
          Всего позиций: {scoped.length}
        </span>
        <span className="mt-1 block font-medium">Решено: {counts.resolved}</span>
        <span className="mt-1 block font-medium">Осталось решить: {remaining}</span>
        <span className="mt-1 block font-medium">Выбрано: {filter === "rejected" ? 0 : chosenKeys.length}</span>
        <span className="mt-1 block text-mute">
          {priceDone
            ? "Прайс полностью обработан."
            : "Прайс ещё не обработан: подтвердите совпадения кнопкой «Да» или отметьте «Не работаем»."}
        </span>
      </p>
      {analyzing ? <Hint>Анализируем номенклатуру...</Hint> : null}
      {state.catalog.length === 0 ? (
        <Hint>
          Загрузите номенклатуру из 1С на вкладке{" "}
          <Link className="text-brand underline" to="/nomenclature-1c">
            «Номенклатура 1С»
          </Link>
          , чтобы появились предложения.
        </Hint>
      ) : null}
      {notice ? (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-green-50 text-ok" : "bg-amber-50 text-warn"}`}>
          <span>{notice.text}</span>
          <Button variant="quiet" onClick={clearNotice}>
            Скрыть
          </Button>
        </div>
      ) : null}
      {filter !== "rejected" && chosenKeys.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-card">
          <span className="text-sm font-medium text-ink">Выбрано: {chosenKeys.length}</span>
          <Button
            variant="yes"
            disabled={confirmableKeys.length === 0}
            onClick={() => {
              confirmMatchesMany(confirmableKeys);
              setSelected(new Set());
            }}
          >
            Да
          </Button>
          <Button variant="ghost" disabled={openKeys.length === 0} onClick={() => setPending({ kind: "reject", keys: openKeys })}>
            Не работаем
          </Button>
        </div>
      ) : null}
      {filter === "rejected" ? (
        rejectedVisible.length === 0 ? (
          <Card title="Не работаем">
            <Hint>Нет товаров, по которым принято решение «Не работаем».</Hint>
          </Card>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[10px] border border-slate-200 bg-white shadow-card">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col style={{ width: "28%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "42%" }} />
              </colgroup>
              <thead>
                <tr>
                  {["Номенклатура поставщика", "Поставщик", "Штрихкод", "Действие"].map((title) => (
                    <th key={title} className={headCell}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rejectedVisible.slice(0, pager.count).map((item) => (
                  <tr key={item.id} className="border-b border-black/5 bg-slate-50">
                    <td className={bodyCell}>
                      <ClampText text={item.traits.name} />
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={item.supplier} />
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={item.traits.barcode || "—"} />
                    </td>
                    <td className={bodyCell}>
                      <Button variant="ghost" className="!px-1.5 !py-0.5 whitespace-nowrap" onClick={() => releaseMatch(item.id)}>
                        Вернуть в работу
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : visible.length === 0 ? (
        <Card title="Сопоставление">
          <Hint>{filter === "resolved" && priceDone ? "Прайс полностью обработан." : "Нет товаров в этом фильтре."}</Hint>
        </Card>
      ) : (
        <div className="max-h-[70vh] overflow-x-auto overflow-y-auto rounded-[10px] border border-slate-200 bg-white shadow-card">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "3%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "21%" }} />
              <col style={{ width: "21%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className={`${headCell} w-10 max-w-[44px] px-1 text-center`} title="Выбрать все отображаемые">
                  <input
                    type="checkbox"
                    className="align-middle"
                    title="Выбрать все отображаемые"
                    aria-label="Выбрать все отображаемые"
                    checked={allChecked}
                    ref={(node) => {
                      if (node) node.indeterminate = someChecked;
                    }}
                    onChange={toggleAll}
                  />
                </th>
                <th className={headCell}>Поставщик</th>
                <th className={headCell}>Номенклатура поставщика</th>
                <th className={headCell}>Предлагаемая наша номенклатура</th>
                <th className={`${headCell} text-center`}>Уверенность</th>
                <th className={headCell}>Почему</th>
                <th className={headCell}>Статус</th>
                <th className={headCell}>Действие</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const match = state.matches[row.key] ?? EMPTY_MATCH;
                const item = match.code ? catalog.get(match.code) : undefined;
                const conflict = Boolean(item && unitsConflict(row.unit, item.unit));
                const label = match.relation === "alternative"
                  ? "Альтернатива"
                  : match.status === "missing"
                    ? "Нет в нашей номенклатуре"
                    : conflict && match.status === "need"
                      ? "Конфликт единицы"
                      : statusLabel(match.status);
                const locked = match.status === "confirmed" || match.status === "picked";
                const picked = selected.has(row.key);
                const ours = ourNomenclature(match.code, catalog);
                const reason = match.reason || "—";
                return (
                  <tr
                    key={row.key}
                    className={`cursor-pointer border-b border-black/5 ${picked ? "bg-[#E7F0FA]" : statusRowClass(match.status, conflict)}`}
                    onMouseDown={(event) => {
                      if (event.shiftKey) event.preventDefault();
                    }}
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof HTMLElement && target.closest("button, a, input, label")) return;
                      selectRow(row.key, event);
                    }}
                  >
                    <td className={`${bodyCell} px-1 text-center`}>
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${row.name}`}
                        checked={picked}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleOne(row.key)}
                      />
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={row.supplier} />
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={row.name} />
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={ours} />
                    </td>
                    <td className={`${bodyCell} text-center tabular-nums ${confidenceClass(match.confidence)}`}>
                      {confidenceLabel(match.confidence)}
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={reason} />
                    </td>
                    <td className={bodyCell}>
                      <ClampText text={label} />
                    </td>
                    <td className={bodyCell}>
                      <div className="flex flex-nowrap items-center gap-1">
                        <Button
                          variant="yes"
                          className="shrink-0 !px-1.5 !py-0.5 whitespace-nowrap"
                          disabled={!match.code || locked}
                          onClick={() => confirmMatch(row.key)}
                        >
                          Да
                        </Button>
                        <Button
                          variant="ghost"
                          className="shrink-0 !px-1.5 !py-0.5 whitespace-nowrap"
                          disabled={state.catalog.length === 0 || locked}
                          onClick={(event) => openPicker(row.key, event.currentTarget)}
                        >
                          Выбрать другой
                        </Button>
                        <Button
                          variant="ghost"
                          className="shrink-0 !px-1.5 !py-0.5 whitespace-nowrap"
                          disabled={match.status === "rejected"}
                          onClick={() => rejectMatch(row.key)}
                        >
                          Не работаем
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
      {pager.count < (filter === "rejected" ? rejectedVisible.length : filtered.length) ? (
        <Button variant="secondary" onClick={pager.showMore}>
          Показать ещё
        </Button>
      ) : null}
      {(filter === "rejected" ? rejectedVisible.length : filtered.length) > 0 ? (
        <Hint>
          Показано {Math.min(pager.count, filter === "rejected" ? rejectedVisible.length : filtered.length)} из{" "}
          {filter === "rejected" ? rejectedVisible.length : filtered.length}. Выбор «все отображаемые» включает весь текущий фильтр и поиск, не только эту страницу.
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
      {pending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="max-w-lg rounded-[10px] bg-white p-5 shadow-card">
            <p className="whitespace-pre-line text-sm text-ink">
              {`Отметить ${pending.keys.length} ${plural(pending.keys.length, "позицию", "позиции", "позиций")} как «Не работаем»?\n\nЭти позиции не будут повторно предлагаться для сопоставления при следующих загрузках прайса этого поставщика.\n\nРешение можно будет изменить позже.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPending(null)}>
                Отмена
              </Button>
              <Button onClick={applyPending}>Подтвердить</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
