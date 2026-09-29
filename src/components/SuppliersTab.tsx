import { useState } from "react";
import { useAppState } from "../hooks/useAppState";
import type { IsoWeekday, SupplierCard } from "../types";
import { createSupplier, oneCStatusLabel, orderDaysLabel, WEEKDAYS } from "../utils/suppliers";
import { Button, Field, controlClass } from "./Button";
import { Card, Hint } from "./Card";

function lines(value: string): string[] {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function blankCard(): SupplierCard {
  return createSupplier("");
}

export function SuppliersTab() {
  const { state, saveSupplier } = useAppState();
  const [draft, setDraft] = useState<SupplierCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  function edit(card: SupplierCard) {
    setError(null);
    setDraft({ ...card, oneC: { ...card.oneC }, schedule: { ...card.schedule, reminders: [...card.schedule.reminders] }, orderDays: [...card.orderDays] });
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
                <div>
                  <div className="font-medium">{card.name}{card.active ? "" : " · неактивен"}</div>
                  <div className="text-sm text-mute">
                    {card.orderDays.length > 0 ? orderDaysLabel(card.orderDays) : "Дни заказа не заданы"}
                    {card.responsible ? ` · ${card.responsible}` : ""}
                  </div>
                  <div className="text-xs text-mute">{oneCStatusLabel(card)}</div>
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
            <Field label="Название в программе">
              <input className={controlClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
              Активен
            </label>
            <Field label="Ответственный сотрудник">
              <input className={controlClass} value={draft.responsible} onChange={(event) => setDraft({ ...draft, responsible: event.target.value })} />
            </Field>
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
            <Field label="Другие названия в прайсах">
              <textarea className={controlClass} rows={2} value={draft.aliases.join("\n")} onChange={(event) => setDraft({ ...draft, aliases: lines(event.target.value) })} />
            </Field>
            <Field label="Email поставщика">
              <textarea className={controlClass} rows={2} value={draft.emails.join("\n")} onChange={(event) => setDraft({ ...draft, emails: lines(event.target.value) })} />
            </Field>
            <Field label="ИНН">
              <input className={controlClass} value={draft.inns.join(", ")} onChange={(event) => setDraft({ ...draft, inns: lines(event.target.value) })} />
            </Field>
            <p className="text-sm font-medium">{oneCStatusLabel(draft)}</p>
            <Hint>Прайс можно загрузить и без связи с 1С. Передача заказа в 1С будет доступна только когда заполнены GUID объектов.</Hint>
            <div className="grid gap-3 sm:grid-cols-2">
              <OneCFields draft={draft} onChange={setDraft} />
            </div>
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
