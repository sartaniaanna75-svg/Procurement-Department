import { useMemo } from "react";
import { useAppState } from "../hooks/useAppState";
import type { SupplierCard } from "../types";
import { dateISO, formatDay, isoWeekday, parseDay, procurementBoard, type CycleStatus } from "../utils/procurement";
import { Card, Hint } from "./Card";

type Paint = "ok" | "alert" | "plain";

/** Красный только когда по уже рассчитанному статусу нужно внимание. До начала окна ожидания карточка белая. */
function paint(item: CycleStatus, card: SupplierCard | undefined, now: Date): Paint {
  if (item.freshness === "received") return "ok";
  if (item.freshness === "not_required") return "plain";
  if (item.freshness === "expected" && !waitingStarted(card, item.cycleDate, now)) return "plain";
  if (item.freshness === "expected" || item.freshness === "missing" || item.freshness === "stale") return "alert";
  return "plain";
}

function waitingStarted(card: SupplierCard | undefined, cycleDate: string, now: Date): boolean {
  if (!card || card.schedule.expectFrom == null || !cycleDate) return true;
  const order = parseDay(cycleDate);
  const back = (isoWeekday(order) - card.schedule.expectFrom + 7) % 7;
  const start = new Date(order);
  start.setDate(order.getDate() - back);
  start.setHours(0, 0, 0, 0);
  return now.getTime() >= start.getTime();
}

function receivedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDay(dateISO(date));
}

const boxClass: Record<Paint, string> = {
  ok: "border-[#D5E8DC] bg-[#F3F8F4]",
  alert: "border-[#F0D5D5] bg-[#FDF4F4]",
  plain: "border-slate-200 bg-white",
};

const statusClass: Record<Paint, string> = {
  ok: "text-sm font-semibold text-ok",
  alert: "text-sm font-semibold text-[#9F2D2D]",
  plain: "text-sm text-ink",
};

function Row({ item, card }: { item: CycleStatus; card?: SupplierCard }) {
  const kind = paint(item, card, new Date());
  const received = receivedLabel(item.receivedAt);
  return (
    <div className={`rounded-lg border px-3 py-2 ${boxClass[kind]}`}>
      <div className="font-medium">{item.name}</div>
      {item.cycleDate ? <p className="text-sm text-mute">Ближайший заказ: {formatDay(item.cycleDate)}</p> : null}
      <p className={statusClass[kind]}>{item.text}</p>
      {received ? <p className="text-xs text-mute">Прайс получен: {received}</p> : null}
      {item.expectedAt && item.freshness === "expected" ? <p className="text-xs text-mute">Крайний срок: {item.expectedAt}</p> : null}
      {item.expectedAt && (item.freshness === "missing" || item.freshness === "stale") ? (
        <p className="text-xs text-mute">Прайс ожидался: {item.expectedAt}</p>
      ) : null}
      {item.reminder ? <p className="text-sm text-amber-800">Срок получения прайса приближается</p> : null}
      {item.responsible ? <p className="text-xs text-mute">Ответственный: {item.responsible}</p> : null}
      {item.watch ? <p className="text-sm text-amber-800">{item.watch}</p> : null}
    </div>
  );
}

function Group({ title, items, suppliers }: { title: string; items: CycleStatus[]; suppliers: SupplierCard[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-brand">{title}</h3>
      {items.map((item) => (
        <Row key={`${title}-${item.supplierId}-${item.cycleDate || item.timing}`} item={item} card={suppliers.find((supplier) => supplier.id === item.supplierId)} />
      ))}
    </div>
  );
}

export function ProcurementPanel() {
  const { state } = useAppState();
  const board = useMemo(() => procurementBoard(state), [state]);
  const empty = board.today.length + board.upcoming.length + board.missing.length + board.expected.length + board.demand.length === 0;
  return (
    <Card title="Закупки">
      {empty ? (
        <Hint>Сейчас нет событий по закупкам. День заказа, ожидание прайса и потребность появятся здесь, когда для поставщика они наступят.</Hint>
      ) : (
        <div className="space-y-4">
          <Group title="Заказы сегодня" items={board.today} suppliers={state.suppliers} />
          <Group title="Ближайшие заказы" items={board.upcoming} suppliers={state.suppliers} />
          <Group title="Нет актуального прайса" items={board.missing} suppliers={state.suppliers} />
          <Group title="Прайс ожидается" items={board.expected} suppliers={state.suppliers} />
          <Group title="По потребности" items={board.demand} suppliers={state.suppliers} />
        </div>
      )}
    </Card>
  );
}
