import { useState } from "react";
import { useAppState } from "../hooks/useAppState";
import type { IsoWeekday, OfferSource, PurchaseMode, SupplierCard } from "../types";
import { createSupplier, offerSourceLabel, OFFER_SOURCES, oneCStatusLabel, PURCHASE_MODES, purchaseModeLabel, scheduleUsesDays, WEEKDAYS } from "../utils/suppliers";
import { Button, Field, controlClass } from "./Button";
import { Card, Hint } from "./Card";

function lines(value: string): string[] {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function blankCard(): SupplierCard {
  return createSupplier("");
}

export function SuppliersTab() {
  const { state, saveSupplier, markPurchaseNeed } = useAppState();
  const [draft, setDraft] = useState<SupplierCard | null>(null);
  const [need, setNeed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(card: SupplierCard) {
    setError(null);
    setNeed(Boolean(state.purchaseNeed[card.id]));
    setDraft({
      ...card,
      oneC: { ...card.oneC },
      schedule: { ...card.schedule, reminders: [...card.schedule.reminders] },
      orderDays: [...card.orderDays],
      aliases: [...card.aliases],
      priceNames: [...card.priceNames],
      emails: [...card.emails],
      inns: [...card.inns],
    });
  }

  function toggleDay(day: IsoWeekday) {
    if (!draft) return;
    const orderDays = draft.orderDays.includes(day) ? draft.orderDays.filter((item) => item !== day) : [...draft.orderDays, day];
    setDraft({ ...draft, orderDays });
  }

  function save() {
    if (!draft?.name.trim()) {
      setError("Укажите название поставщика.");
      return;
    }
    saveSupplier(draft);
    const tracksNeed = draft.purchaseMode === "demand" || draft.purchaseMode === "mixed";
    markPurchaseNeed(draft.id, tracksNeed && need);
    setDraft(null);
    setError(null);
  }

  return (
    <div className="space-y-4">
      <Card title="Поставщики">
        <Hint>Карточка хранит поставщика постоянно. Имя при загрузке прайса заново не вводится, если поставщик уже известен.</Hint>
        <div className="mt-3">
          <Button
            variant="secondary"
            onClick={() => edit(blankCard())}
          >
            Новый поставщик
          </Button>
        </div>
        {state.suppliers.length === 0 ? (
          <p className="mt-3 text-sm text-mute">Справочник пока пуст.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {state.suppliers.map((card) => (
              <div key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="grid flex-1 gap-1 text-sm sm:grid-cols-6">
                  <div>
                    <div className="text-xs text-mute">Поставщик</div>
                    <div className="font-medium">{card.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-mute">Источник</div>
                    <div>{offerSourceLabel(card.offerSource)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-mute">Режим закупки</div>
                    <div>{purchaseModeLabel(card.purchaseMode)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-mute">Ответственный</div>
                    <div>{card.responsible || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-mute">Связь с 1С</div>
                    <div>{oneCStatusLabel(card)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-mute">Состояние</div>
                    <div>{card.active ? "Активен" : "Неактивен"}</div>
                  </div>
                </div>
                <Button variant="secondary" onClick={() => edit(card)}>
                  Карточка
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {draft ? (
        <Card title={state.suppliers.some((card) => card.id === draft.id) ? draft.name || "Карточка" : "Новый поставщик"}>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-brand">Основное</h3>
            <Field label="Название в программе">
              <input className={controlClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="Полное название">
              <input className={controlClass} value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
            </Field>
            <Field label="ИНН">
              <input className={controlClass} value={draft.inns.join(", ")} onChange={(event) => setDraft({ ...draft, inns: lines(event.target.value) })} />
            </Field>
            <Field label="Ответственный сотрудник">
              <input className={controlClass} value={draft.responsible} onChange={(event) => setDraft({ ...draft, responsible: event.target.value })} />
            </Field>
            <Field label="Комментарий">
              <textarea className={controlClass} rows={2} value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
              Активен
            </label>
            <h3 className="text-sm font-semibold text-brand">Источник закупки</h3>
            <Field label="Источник предложения">
              <select
                className={controlClass}
                value={draft.offerSource}
                onChange={(event) => setDraft({ ...draft, offerSource: event.target.value as OfferSource })}
              >
                {OFFER_SOURCES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
            {draft.offerSource === "site" || draft.offerSource === "manual" ? (
              <Hint>Для этого источника отсутствие файла прайса не считается ошибкой.</Hint>
            ) : null}
            {draft.offerSource === "api" ? <Hint>Вариант для будущей интеграции. Сейчас он только сохраняется в карточке.</Hint> : null}
            <h3 className="text-sm font-semibold text-brand">Режим закупки</h3>
            <Field label="Режим">
              <select
                className={controlClass}
                value={draft.purchaseMode}
                onChange={(event) => setDraft({ ...draft, purchaseMode: event.target.value as PurchaseMode })}
              >
                {PURCHASE_MODES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Hint>
              {scheduleUsesDays(draft.purchaseMode)
                ? "Плановые закупки идут по отмеченным дням. Если дни не заданы, календарь этого поставщика не ведёт."
                : "Фиксированные дни заказа не обязательны и не создают предупреждение об отсутствии прайса."}
            </Hint>
            {draft.purchaseMode === "demand" || draft.purchaseMode === "mixed" ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={need} onChange={(event) => setNeed(event.target.checked)} />
                  Есть потребность в закупке
                </label>
                <Hint>Пока отмечается вручную. Расчёт потребности будет отдельным модулем. Если потребности нет, отсутствие прайса ошибкой не считается.</Hint>
              </>
            ) : null}
            <div>
              <div className="mb-1 text-sm font-medium">Дни заказа</div>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <Button key={day.id} variant="filter" active={draft.orderDays.includes(day.id)} onClick={() => toggleDay(day.id)}>
                    {day.short}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Прайс ожидаем с">
                <select
                  className={controlClass}
                  value={draft.schedule.expectFrom ?? ""}
                  onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, expectFrom: event.target.value ? (Number(event.target.value) as IsoWeekday) : null } })}
                >
                  <option value="">Не задано</option>
                  {WEEKDAYS.map((day) => (
                    <option key={day.id} value={day.id}>{day.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Прайс ожидаем по">
                <select
                  className={controlClass}
                  value={draft.schedule.expectTo ?? ""}
                  onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, expectTo: event.target.value ? (Number(event.target.value) as IsoWeekday) : null } })}
                >
                  <option value="">Не задано</option>
                  {WEEKDAYS.map((day) => (
                    <option key={day.id} value={day.id}>{day.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="День крайнего срока">
                <select
                  className={controlClass}
                  value={draft.schedule.deadlineWeekday ?? ""}
                  onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, deadlineWeekday: event.target.value ? (Number(event.target.value) as IsoWeekday) : null } })}
                >
                  <option value="">День заказа</option>
                  {WEEKDAYS.map((day) => (
                    <option key={day.id} value={day.id}>{day.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Время крайнего срока">
                <input
                  className={controlClass}
                  type="time"
                  value={draft.schedule.deadlineTime}
                  onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, deadlineTime: event.target.value } })}
                />
              </Field>
              <Field label="Срок актуальности, дней">
                <input
                  className={controlClass}
                  inputMode="numeric"
                  value={draft.schedule.validityDays ?? ""}
                  placeholder="Пока не придёт новый прайс цикла"
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    const validityDays = raw === "" ? null : Number(raw);
                    setDraft({ ...draft, schedule: { ...draft.schedule, validityDays: validityDays !== null && Number.isFinite(validityDays) ? validityDays : null } });
                  }}
                />
              </Field>
              <Field label="Напоминания, часов до срока">
                <input
                  className={controlClass}
                  value={draft.schedule.reminders.map((stage) => stage.hoursBeforeDeadline).join(", ")}
                  placeholder="Например 48, 2"
                  onChange={(event) => {
                    const reminders = lines(event.target.value)
                      .map((item) => Number(item))
                      .filter((hours) => Number.isFinite(hours) && hours >= 0)
                      .map((hours) => ({ id: `rem-${hours}`, hoursBeforeDeadline: hours }));
                    setDraft({ ...draft, schedule: { ...draft.schedule, reminders } });
                  }}
                />
              </Field>
            </div>
            <h3 className="text-sm font-semibold text-brand">Связь с 1С</h3>
            <p className="text-sm font-medium">{oneCStatusLabel(draft)}</p>
            <Hint>Прайс можно загрузить и без связи с 1С. Передача заказа в 1С будет доступна только когда заполнены GUID объектов.</Hint>
            <div className="grid gap-3 sm:grid-cols-2">
              <OneCFields draft={draft} onChange={setDraft} />
            </div>
            <h3 className="text-sm font-semibold text-brand">Распознавание поставщика</h3>
            <Hint>Поставщик определяется по совокупности признаков, а не только по имени файла.</Hint>
            <Field label="Варианты названия">
              <textarea className={controlClass} rows={2} value={draft.aliases.join("\n")} onChange={(event) => setDraft({ ...draft, aliases: lines(event.target.value) })} />
            </Field>
            <Field label="Названия из прайсов">
              <textarea className={controlClass} rows={2} value={draft.priceNames.join("\n")} onChange={(event) => setDraft({ ...draft, priceNames: lines(event.target.value) })} />
            </Field>
            <Field label="Email поставщика">
              <textarea className={controlClass} rows={2} value={draft.emails.join("\n")} placeholder="Для будущего получения прайса из почты" onChange={(event) => setDraft({ ...draft, emails: lines(event.target.value) })} />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex gap-2">
              <Button onClick={save}>Сохранить карточку</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>Закрыть</Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function OneCFields({ draft, onChange }: { draft: SupplierCard; onChange: (card: SupplierCard) => void }) {
  const link = draft.oneC;
  function set(field: keyof typeof link, value: string) {
    onChange({ ...draft, oneC: { ...link, [field]: value } });
  }
  const fields: Array<{ key: keyof typeof link; label: string }> = [
    { key: "name", label: "Название в 1С" },
    { key: "guid", label: "GUID поставщика в 1С" },
    { key: "partner", label: "Партнёр 1С" },
    { key: "partnerGuid", label: "GUID партнёра" },
    { key: "counterparty", label: "Контрагент 1С" },
    { key: "counterpartyGuid", label: "GUID контрагента" },
    { key: "agreement", label: "Соглашение 1С" },
    { key: "agreementGuid", label: "GUID соглашения" },
    { key: "contract", label: "Договор 1С" },
    { key: "contractGuid", label: "GUID договора" },
    { key: "organization", label: "Наша организация 1С" },
    { key: "organizationGuid", label: "GUID организации" },
  ];
  return (
    <>
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          <input className={controlClass} value={link[field.key]} onChange={(event) => set(field.key, event.target.value)} />
        </Field>
      ))}
    </>
  );
}
