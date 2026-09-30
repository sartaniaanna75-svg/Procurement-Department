/**
 * Кратность закупки из наименования номенклатуры после символа "*".
 * Пример: «Майонез Байсад 150г*52» → 52.
 * Значение 1 не считаем достоверной упаковкой.
 */

export function extractPackMultiplicity(name: string): number | null {
  const text = name.trim();
  if (!text) return null;

  // Предпочтительный формат: *N в конце строки (опционально «шт»).
  const atEnd = text.match(/\*(\d{1,6})\s*(?:шт\.?)?\s*$/i);
  if (atEnd) {
    const value = Number(atEnd[1]);
    return Number.isInteger(value) && value > 1 ? value : null;
  }

  // Запасной: последнее *N ближе к концу названия (после него мало символов).
  const matches = [...text.matchAll(/\*(\d{1,6})/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const index = last.index ?? -1;
  if (index < 0) return null;
  const after = text.slice(index + last[0].length).trim();
  if (after && !/^(шт\.?|[)\].,;]+)$/i.test(after)) return null;
  const value = Number(last[1]);
  return Number.isInteger(value) && value > 1 ? value : null;
}

export function resolvePackMultiplicity(name: string, override: number | undefined): number | null {
  if (override !== undefined && Number.isInteger(override) && override > 1) return override;
  return extractPackMultiplicity(name);
}
