import type { MatchFilter, MatchStatus, PriceFilter } from "../types";

export function formatPrice(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string): string {
  if (!iso) return "дата неизвестна";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function todayISO(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function passesFilter(status: MatchStatus, filter: PriceFilter | MatchFilter): boolean {
  if (filter === "all") return true;
  if (filter === "resolved") return status === "confirmed" || status === "picked" || status === "missing";
  if (filter === "confirmed") return status === "confirmed" || status === "picked";
  if (filter === "missing") return status === "missing";
  if (filter === "rejected") return status === "rejected";
  if (filter === "review") return status === "review";
  return status === "need";
}

export function statusLabel(status: MatchStatus): string {
  switch (status) {
    case "need":
      return "Нужно решить";
    case "confirmed":
      return "Подтверждено";
    case "picked":
      return "Выбрано";
    case "missing":
      return "Отсутствует";
    case "rejected":
      return "Не работаем";
    case "review":
      return "На проверке";
  }
}

export function statusRowClass(status: MatchStatus, unitConflict: boolean): string {
  if (status === "rejected") return "bg-slate-50";
  if (status === "missing" || (unitConflict && status !== "confirmed" && status !== "picked")) {
    return "bg-red-50";
  }
  if (status === "confirmed" || status === "picked") return "bg-green-50";
  if (status === "review") return "bg-orange-50";
  return "bg-amber-50";
}

export function absentKey(code: string, supplier: string): string {
  return `${code}|${supplier}`;
}
