export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е");
}

export function supplierKey(name: string): string {
  return normalizeText(name);
}

export function normCode(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}
