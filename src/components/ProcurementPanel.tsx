import { useMemo } from "react";
import { useAppState } from "../hooks/useAppState";
import type { SupplierCard } from "../types";
import { procurementBoard, type CycleStatus } from "../utils/procurement";
import { oneCStatusLabel } from "../utils/suppliers";
import { Card, Hint } from "./Card";

function tone(level: CycleStatus["level"]): string {
  if (level === "ready") return "text-ok";
  if (level === "critical") return "text-danger";
  if (level === "attention") return "text-amber-800";
  return "text-mute";
}

function Group({ title, items, suppliers }: { title: string; items: CycleStatus[]; suppliers: SupplierCard[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-brand">{title}</h3>
      {items.map((item) => {
        const card = suppliers.find((supplier) => supplier.id === item.supplierId);
        return (
          <div key={`${title}-${item.supplierId}-${item.cycleDate}`} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="font-medium">{item.name}</div>
            <p className={`text-sm ${tone(item.level)}`}>{item.text}</p>
            {item.responsible ? <p className="text-xs text-mute">Ответственный: {item.responsible}</p> : null}
            <p className="text-xs text-mute">{card ? oneCStatusLabel(card) : ""}</p>
            {item.watch ? <p className="text-sm text-amber-800">{item.watch}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ProcurementPanel() {
  const { state } = useAppState();
  const board = useMemo(() => procurementBoard(state), [state]);
  const scheduled = state.suppliers.filter((card) => card.active && card.orderDays.length > 0);
  return (
    <Card title="Календарь закупок">
      {scheduled.length === 0 ? (
        <Hint>Укажите дни заказа в карточке поставщика. Прайс может прийти раньше дня заказа и останется подходящим для ближайшего цикла.</Hint>
      ) : (
        <div className="space-y-4">
          <Group title="Сегодня" items={board.today} suppliers={state.suppliers} />
          <Group title="Завтра" items={board.tomorrow} suppliers={state.suppliers} />
          <Group title="Ближайшие заказы" items={board.later} suppliers={state.suppliers} />
          {board.today.length === 0 && board.tomorrow.length === 0 && board.later.length === 0 ? (
            <Hint>На ближайшие дни заказов нет.</Hint>
          ) : null}
        </div>
      )}
    </Card>
  );
}
