/**
 * Единая точка разбора прайса поставщика.
 * Кнопка загрузки и будущий агент почты вызывают одну и ту же функцию.
 */
export {
  acceptPriceColumn,
  ingestPriceSource,
  normalizeLoadedPrice,
  normalizePriceFile,
  type NormalizedPriceDocument,
  type PriceIntakeResult,
  type PriceQuestion,
} from "./priceIntake";
