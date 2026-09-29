const UNIT_PATTERNS: Array<[RegExp, string]> = [
  [/^(кг|kg|килограмм|килограмма|килограммов|килограммы|kilogram|kilograms)$/, "kg"],
  [/^(г|гр|грамм|грамма|граммов|граммы|gram|grams|g)$/, "g"],
  [/^(л|литр|литра|литров|литры|liter|liters|litre|litres|l)$/, "l"],
  [/^(мл|миллилитр|миллилитра|миллилитров|ml)$/, "ml"],
  [/^(шт|штука|штуки|штук|pcs|pc|piece|pieces)$/, "pcs"],
  [/^(уп|упак|упаковка|упаковки|pack)$/, "pack"],
  [/^(м|метр|метра|метров|meter|meters)$/, "m"],
  [/^(см|сантиметр|сантиметра|сантиметров|cm)$/, "cm"],
];

export function normalizeUnit(raw: string): string {
  const compact = raw
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\./g, "")
    .replace(/\s+/g, "");
  if (!compact) return "";
  for (const [pattern, unit] of UNIT_PATTERNS) {
    if (pattern.test(compact)) return unit;
  }
  return compact;
}

export function unitsConflict(left: string, right: string): boolean {
  const a = normalizeUnit(left);
  const b = normalizeUnit(right);
  if (!a || !b) return false;
  return a !== b;
}

export function unitRelation(rowUnit: string, catalogUnit: string): "ok" | "conflict" | "unknown" {
  const a = normalizeUnit(rowUnit);
  const b = normalizeUnit(catalogUnit);
  if (!a || !b) return "unknown";
  return a === b ? "ok" : "conflict";
}
