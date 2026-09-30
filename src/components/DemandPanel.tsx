import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../hooks/useAppState";
import { useDemandState } from "../hooks/useDemandState";
import { useShowMore } from "../hooks/useShowMore";
import { explainCalculation, formatQty } from "../utils/demand/calculate";
import { scenarioLabel, type DemandFilter, type DemandLine, type DemandSort } from "../utils/demand/buildLines";
import type { CoverDays, DemandSourceKind } from "../utils/demand/types";
import { COVER_DAYS } from "../utils/demand/types";
import { formatDate } from "../utils/format";
import { TABLE_ACCEPT } from "../utils/parseFile";
import { Button, FilterBar, Field, controlClass } from "./Button";
import { Card, Hint } from "./Card";

function sourceStatus(
  label: string,
  meta: { loadedAt: string; periodLabel: string; rowCount: number } | undefined,
): string {
  if (!meta) return `${label}: не загружен`;
  const when = formatDate(meta.loadedAt);
  const period = meta.periodLabel ? `, период ${meta.periodLabel}` : "";
  return `${label}: загружено ${when}${period} (${meta.rowCount})`;
}

function num(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return formatQty(value);
}

function FileSlot({
  label,
  kind,
  hint,
}: {
  label: string;
  kind: DemandSourceKind;
  hint?: string;
}) {
  const { busy, importSource } = useDemandState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosenName, setChosenName] = useState("");

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-sm font-medium">{label}</div>
      {hint ? <p className="mt-0.5 text-xs text-mute">{hint}</p> : null}
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={TABLE_ACCEPT}
        disabled={busy}
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setChosenName(file.name);
          void importSource(kind, file);
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          Выбрать файл
        </Button>
        <span className="text-sm text-mute">{chosenName || "Файл не выбран"}</span>
      </div>
    </div>
  );
}

function WhyPanel({ line }: { line: DemandLine }) {
  const { workspace } = useDemandState();
  const [days, setDays] = useState<CoverDays>(21);
  const lines = explainCalculation(
    {
      name: line.name,
      available: line.available,
      onHand: line.onHand,
      expected: line.expected,
      avgDaily: line.avgDaily,
      stockDays: line.stockDays,
      packOverride: workspace.packOverrides[line.catalogCode],
      includeExpectedReceipts: workspace.includeExpectedReceipts,
    },
    days,
  );
  return (
    <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-ink">
      <div className="mb-2 flex flex-wrap gap-1">
        {COVER_DAYS.map((value) => (
          <Button key={value} variant="filter" active={days === value} onClick={() => setDays(value)}>
            {value} дн.
          </Button>
        ))}
      </div>
      {lines.map((text, index) => (
        <div key={`${index}-${text}`}>{text || "\u00a0"}</div>
      ))}
    </div>
  );
}

function DecisionEditor({ line }: { line: DemandLine }) {
  const { saveDecision, acceptScenario } = useDemandState();
  const existing = line.decision;
  const [days, setDays] = useState<CoverDays>(existing?.scenarioDays ?? 21);
  const scenario = line.calc.scenarios[days];
  const [packs, setPacks] = useState(
    String(existing?.userPacks ?? existing?.userQty ?? scenario.packs ?? scenario.qty ?? ""),
  );
  const [comment, setComment] = useState(existing?.comment ?? "");

  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 px-2 py-2 text-xs">
      <div className="flex flex-wrap gap-1">
        {COVER_DAYS.map((value) => (
          <Button key={value} variant="filter" active={days === value} onClick={() => setDays(value)}>
            Взять {value}
          </Button>
        ))}
        <Button variant="yes" onClick={() => acceptScenario(line, days)}>
          Согласна с расчётом
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={line.packSize ? "Моё решение, упак." : "Моё решение, шт."}>
          <input className={controlClass} value={packs} onChange={(event) => setPacks(event.target.value)} />
        </Field>
        <Field label="Почему изменила?">
          <input className={controlClass} value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          const value = Number(String(packs).replace(",", "."));
          if (!Number.isFinite(value) || value < 0) return;
          const isPacks = Boolean(line.packSize);
          const userPacks = isPacks ? Math.round(value) : null;
          const userQty = isPacks && line.packSize ? Math.round(value) * line.packSize : Math.round(value);
          saveDecision({
            catalogCode: line.catalogCode,
            scenarioDays: days,
            recommendedPacks: scenario.packs,
            recommendedQty: scenario.qty,
            userPacks,
            userQty,
            agreedWithCalculation: userQty === scenario.qty,
            comment: comment.trim(),
            decidedAt: new Date().toISOString(),
          });
        }}
      >
        Сохранить решение
      </Button>
      {existing ? (
        <p className="text-mute">
          Сохранено: {existing.userPacks !== null ? `${existing.userPacks} упак.` : `${existing.userQty ?? "—"} шт.`}
          {existing.comment ? ` — ${existing.comment}` : ""} ({formatDate(existing.decidedAt)})
        </p>
      ) : null}
    </div>
  );
}

function DemandRow({ line }: { line: DemandLine }) {
  const { setPackOverride, workspace } = useDemandState();
  const [openWhy, setOpenWhy] = useState(false);
  const [openDecision, setOpenDecision] = useState(false);
  const [packEdit, setPackEdit] = useState(String(workspace.packOverrides[line.catalogCode] ?? line.packSize ?? ""));

  return (
    <tr className="border-t border-slate-100 align-top text-sm">
      <td className="px-2 py-2">
        <div className="font-medium leading-snug">{line.name}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-mute">
          <button type="button" className="text-brand underline" onClick={() => setOpenWhy((value) => !value)}>
            Почему?
          </button>
          <button type="button" className="text-brand underline" onClick={() => setOpenDecision((value) => !value)}>
            Моё решение
          </button>
        </div>
        {openWhy ? <WhyPanel line={line} /> : null}
        {openDecision ? <DecisionEditor line={line} /> : null}
      </td>
      <td className="px-1 py-2 text-right tabular-nums">{num(line.onHand)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{num(line.available)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{num(line.expected)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{num(line.consumption)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{num(line.avgDaily)}</td>
      <td className="px-1 py-2 text-right tabular-nums">{num(line.stockDays)}</td>
      <td className="px-1 py-2 text-right">
        <input
          className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right text-sm"
          value={packEdit}
          title="Кратность закупки"
          onChange={(event) => setPackEdit(event.target.value)}
          onBlur={() => {
            const value = Number(String(packEdit).replace(",", "."));
            if (!Number.isFinite(value) || value <= 1) {
              setPackOverride(line.catalogCode, null);
              setPackEdit(line.packSize ? String(line.packSize) : "");
              return;
            }
            setPackOverride(line.catalogCode, Math.round(value));
          }}
        />
        {!line.packSize ? <div className="text-[10px] text-warn">не определена</div> : null}
      </td>
      {COVER_DAYS.map((days) => (
        <td key={days} className="px-1 py-2 text-right text-xs leading-snug tabular-nums">
          {scenarioLabel(line, days)}
        </td>
      ))}
      <td className="px-1 py-2 text-xs">
        {line.decision
          ? line.decision.agreedWithCalculation
            ? "Согласовано"
            : `Своё: ${line.decision.userPacks ?? line.decision.userQty}`
          : "—"}
      </td>
    </tr>
  );
}

export function DemandPanel() {
  const { state, activeDivisionLabel } = useAppState();
  const {
    ready,
    hasData,
    workspace,
    lines,
    unmatched,
    filter,
    setFilter,
    sort,
    setSort,
    query,
    setQuery,
    busy,
    error,
    info,
    setIncludeExpected,
  } = useDemandState();
  const resetKey = `${filter}|${sort}|${query}|${lines.length}`;
  const { count, showMore } = useShowMore(resetKey, 80);
  const visible = lines.slice(0, count);

  const filterOptions = useMemo(
    () =>
      [
        { id: "all" as const, label: "Все" },
        { id: "need" as const, label: "Требуется закупка" },
        { id: "enough" as const, label: "Запас достаточный" },
        { id: "noPack" as const, label: "Кратность не определена" },
        { id: "unmatched" as const, label: `Не сопоставлено (${unmatched.length})` },
      ] satisfies Array<{ id: DemandFilter; label: string }>,
    [unmatched.length],
  );

  if (!ready) return <Hint>Загрузка модуля потребности…</Hint>;

  if (state.catalog.length === 0) {
    return (
      <Hint>
        Сначала загрузите «Номенклатуру 1С» для {activeDivisionLabel} на{" "}
        <Link className="text-brand underline" to="/nomenclature-1c">
          соответствующей вкладке
        </Link>
        .
      </Hint>
    );
  }

  if (!hasData) {
    return (
      <div className="space-y-4">
        <Hint>Данные для расчёта потребности не загружены.</Hint>
        <Card title="Данные 1С — загрузка для теста">
          <div className="grid gap-3 md:grid-cols-2">
            <FileSlot label="Остатки и доступность товаров" kind="stock" hint="Основной источник" />
            <FileSlot label="Оборачиваемость запасов на складах" kind="turnover" hint="Основной источник" />
            <FileSlot label="Товарный календарь" kind="calendar" hint="Контроль, необязательно" />
            <FileSlot label="Себестоимость — организация 1" kind="costOrg1" hint="Контроль межфирменных передач" />
            <FileSlot label="Себестоимость — организация 2" kind="costOrg2" hint="Контроль межфирменных передач" />
          </div>
          {error ? <p className="mt-3 rounded-md border border-[#F0D5D5] bg-[#FDF4F4] px-2 py-1.5 text-sm text-danger">{error}</p> : null}
          {info ? <p className="mt-3 rounded-md border border-[#D5E8DC] bg-[#F3F8F4] px-2 py-1.5 text-sm text-ok">{info}</p> : null}
          {busy ? <p className="mt-2 text-sm text-mute">Читаем файл…</p> : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#EBD9A8] bg-[#FFFBF0] px-3 py-2 text-sm text-[#8A6A1E]">
        Потребность — тестовый режим. Расчёт не создаёт заказы и не отправляет данные в 1С.
      </div>

      <Card title="Данные 1С">
        <ul className="space-y-1 text-sm text-ink">
          <li>{sourceStatus("Остатки и доступность", workspace.sources.stock)}</li>
          <li>{sourceStatus("Оборачиваемость", workspace.sources.turnover)}</li>
          <li>{sourceStatus("Товарный календарь", workspace.sources.calendar)}</li>
          <li>
            Контроль межфирменных передач:{" "}
            {workspace.sources.costOrg1 || workspace.sources.costOrg2
              ? [workspace.sources.costOrg1 ? "организация 1" : null, workspace.sources.costOrg2 ? "организация 2" : null]
                  .filter(Boolean)
                  .join(", ")
              : "не загружен"}
          </li>
        </ul>
        {workspace.sources.stock?.unrecognizedHeaders?.length || workspace.sources.turnover?.unrecognizedHeaders?.length ? (
          <p className="mt-2 text-xs text-mute">
            Непривязанные заголовки (для контроля):{" "}
            {[...(workspace.sources.stock?.unrecognizedHeaders ?? []), ...(workspace.sources.turnover?.unrecognizedHeaders ?? [])]
              .slice(0, 12)
              .join("; ")}
          </p>
        ) : null}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FileSlot label="Обновить остатки" kind="stock" />
          <FileSlot label="Обновить оборачиваемость" kind="turnover" />
          <FileSlot label="Товарный календарь" kind="calendar" />
          <FileSlot label="Себестоимость — организация 1" kind="costOrg1" />
          <FileSlot label="Себестоимость — организация 2" kind="costOrg2" />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={workspace.includeExpectedReceipts}
            onChange={(event) => setIncludeExpected(event.target.checked)}
          />
          Учитывать ожидаемые поступления в расчёте
        </label>
        {error ? <p className="mt-2 rounded-md border border-[#F0D5D5] bg-[#FDF4F4] px-2 py-1.5 text-sm text-danger">{error}</p> : null}
        {info ? <p className="mt-2 rounded-md border border-[#D5E8DC] bg-[#F3F8F4] px-2 py-1.5 text-sm text-ok">{info}</p> : null}
      </Card>

      <Card title="Потребность">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <FilterBar value={filter} options={filterOptions} onChange={setFilter} />
          <Field label="Поиск">
            <input
              className={`${controlClass} min-w-[220px]`}
              value={query}
              placeholder="НУРИ"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <Field label="Сортировка">
            <select
              className={controlClass}
              value={sort}
              onChange={(event) => setSort(event.target.value as DemandSort)}
            >
              <option value="avgDaily">Среднедневное потребление</option>
              <option value="stockDays">Запас, дней</option>
              <option value="need">Потребность</option>
              <option value="onHand">Остаток</option>
              <option value="name">Название</option>
            </select>
          </Field>
        </div>

        {filter === "unmatched" ? (
          unmatched.length === 0 ? (
            <Hint>Все строки отчётов сопоставлены с номенклатурой 1С.</Hint>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas text-left text-brand">
                  <tr>
                    <th className="px-2 py-2">Источник</th>
                    <th className="px-2 py-2">Номенклатура в отчёте</th>
                    <th className="px-2 py-2">Код</th>
                    <th className="px-2 py-2">Штрихкод</th>
                    <th className="px-2 py-2">Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.slice(0, count).map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-1">{row.source === "stock" ? "Остатки" : "Оборачиваемость"}</td>
                      <td className="px-2 py-1">{row.identity.name || "—"}</td>
                      <td className="px-2 py-1">{row.identity.code || "—"}</td>
                      <td className="px-2 py-1">{row.identity.barcode || "—"}</td>
                      <td className="px-2 py-1 text-mute">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unmatched.length > count ? (
                <Button className="mt-3" variant="secondary" onClick={showMore}>
                  Показать ещё
                </Button>
              ) : null}
            </div>
          )
        ) : lines.length === 0 ? (
          <Hint>Нет строк по текущему фильтру и поиску.</Hint>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[1100px] w-full border-collapse">
              <thead className="bg-canvas text-left text-xs text-brand">
                <tr>
                  <th className="px-2 py-2 min-w-[220px]">Номенклатура</th>
                  <th className="px-1 py-2 text-right">Остаток</th>
                  <th className="px-1 py-2 text-right">Доступно</th>
                  <th className="px-1 py-2 text-right">Ожидается</th>
                  <th className="px-1 py-2 text-right">Потребление</th>
                  <th className="px-1 py-2 text-right">Среднедн.</th>
                  <th className="px-1 py-2 text-right">Дней</th>
                  <th className="px-1 py-2 text-right">Упаковка</th>
                  <th className="px-1 py-2 text-right">7 дн.</th>
                  <th className="px-1 py-2 text-right">14 дн.</th>
                  <th className="px-1 py-2 text-right">21 дн.</th>
                  <th className="px-1 py-2 text-right">30 дн.</th>
                  <th className="px-1 py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((line) => (
                  <DemandRow key={line.catalogCode} line={line} />
                ))}
              </tbody>
            </table>
            {lines.length > count ? (
              <Button className="mt-3" variant="secondary" onClick={showMore}>
                Показать ещё ({count} из {lines.length})
              </Button>
            ) : (
              <p className="mt-2 text-xs text-mute">Показано {lines.length} позиций.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
