import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../hooks/useAppState";
import { formatPrice, plural } from "../utils/format";
import { buildOrder, countReadyMatches } from "../utils/order";
import { Button } from "./Button";
import { Card, Hint } from "./Card";
import { DemandPanel } from "./DemandPanel";

type OrderSection = "demand" | "compare" | "ready";

function LegacyOrderBuilder() {
  const { state, confirmOrder, markAbsent } = useAppState();
  const [built, setBuilt] = useState(false);
  const readyCount = countReadyMatches(state);
  const draft = built ? buildOrder(state) : null;

  useEffect(() => {
    if (readyCount === 0) setBuilt(false);
  }, [readyCount]);

  return (
    <div className="space-y-4">
      <Card title="Заказ из подтверждённых сопоставлений">
        {readyCount === 0 ? (
          <Hint>
            Подтвердите товары на{" "}
            <Link className="text-brand underline" to="/matching">
              вкладке «Сопоставление»
            </Link>
            . Кнопка «Собрать заказ» станет активной, когда появится хотя бы одна подтверждённая или выбранная позиция.
          </Hint>
        ) : (
          <Hint>
            Можно собрать заказ из {readyCount} {plural(readyCount, "позиции", "позиций", "позиций")}. Для каждого товара
            берётся минимальная цена среди подтверждённых предложений с подходящей единицей.
          </Hint>
        )}
        <div className="mt-3">
          <Button disabled={readyCount === 0} onClick={() => setBuilt(true)}>
            Собрать заказ
          </Button>
        </div>
      </Card>

      {draft && draft.truncated ? (
        <p className="text-sm text-warn">
          Показаны первые 80 из {draft.total} {plural(draft.total, "товара", "товаров", "товаров")}.
        </p>
      ) : null}

      {draft && draft.lines.length === 0 ? <Hint>Подтверждённые позиции не удалось собрать в заказ.</Hint> : null}

      {draft?.lines.map((line) => (
        <article key={line.code} className="rounded-[10px] bg-white p-4 shadow-card">
          <h3 className="font-bold text-ink">
            {line.name}
            {line.unit ? <span className="ml-2 font-normal text-mute">{line.unit}</span> : null}
          </h3>
          {line.errors.map((error) => (
            <p key={error} className="mt-2 text-sm text-danger">
              {error}
            </p>
          ))}
          {line.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-sm text-warn">
              {warning}
            </p>
          ))}
          {line.best ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div>
                  Лучший вариант: {line.best.supplier}, {formatPrice(line.best.price)} ₽
                  {line.best.unit ? ` / ${line.best.unit}` : ""}
                </div>
                {line.second ? (
                  <div className="text-mute">
                    Второй вариант: {line.second.supplier}, {formatPrice(line.second.price)} ₽
                    {line.second.unit ? ` / ${line.second.unit}` : ""}
                  </div>
                ) : null}
                {line.fixed ? <div className="mt-1 text-sm text-ok">Зафиксировано на сегодня</div> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={line.fixed} onClick={() => confirmOrder(line.code, line.best!.supplier, line.best!.price)}>
                  Подтвердить
                </Button>
                <Button variant="secondary" onClick={() => markAbsent(line.code, line.best!.supplier)}>
                  Нет в наличии
                </Button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function OrderTab() {
  const [section, setSection] = useState<OrderSection>("demand");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="filter" active={section === "demand"} onClick={() => setSection("demand")}>
          Потребность
        </Button>
        <Button variant="filter" active={section === "compare"} onClick={() => setSection("compare")}>
          Сравнение поставщиков
        </Button>
        <Button variant="filter" active={section === "ready"} onClick={() => setSection("ready")}>
          Готовые заказы
        </Button>
      </div>

      {section === "demand" ? <DemandPanel /> : null}
      {section === "compare" ? (
        <Card title="Сравнение поставщиков">
          <Hint>Раздел будет в следующем этапе. Сейчас тестируем только «сколько товара нужно».</Hint>
        </Card>
      ) : null}
      {section === "ready" ? <LegacyOrderBuilder /> : null}
    </div>
  );
}
