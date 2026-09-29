/** Подразделения Центра закупок. Один функционал — два независимых набора данных. */

export type DivisionId = "volodarskogo" | "territory";

export const DEFAULT_DIVISION: DivisionId = "volodarskogo";

export const DIVISIONS: Array<{ id: DivisionId; label: string }> = [
  { id: "volodarskogo", label: "Володарского" },
  { id: "territory", label: "Территория" },
];

export function divisionLabel(id: DivisionId): string {
  return DIVISIONS.find((item) => item.id === id)?.label ?? id;
}

export function isDivisionId(value: unknown): value is DivisionId {
  return value === "volodarskogo" || value === "territory";
}

/**
 * Заготовка будущих подключений. Секреты сюда не кладём —
 * только флаги и несекретные метки для UI/архитектуры.
 */
export interface DivisionConnections {
  emailConnection: {
    configured: boolean;
    /** Несекретная метка, например имя ящика без пароля. */
    label: string;
  };
  oneCConnection: {
    configured: boolean;
    /** Несекретная метка базы/контура без токенов. */
    label: string;
  };
}

export function emptyDivisionConnections(): DivisionConnections {
  return {
    emailConnection: { configured: false, label: "" },
    oneCConnection: { configured: false, label: "" },
  };
}
