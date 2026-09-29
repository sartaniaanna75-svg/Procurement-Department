import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const suppliers = await server.ssrLoadModule("/src/utils/suppliers.ts");
const procurement = await server.ssrLoadModule("/src/utils/procurement.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const rows = await server.ssrLoadModule("/src/utils/rows.ts");
const memory = await server.ssrLoadModule("/src/utils/productMemory.ts");
const matching = await server.ssrLoadModule("/src/utils/matching.ts");
const format = await server.ssrLoadModule("/src/utils/format.ts");

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

const mapper = {
  headerRow: 1,
  name: 0,
  price: 1,
  barcode: 2,
  code: -1,
  unit: -1,
  stock: -1,
  pack: -1,
  multiplicity: -1,
  volume: -1,
  labels: { name: "Наименование", price: "Цена", barcode: "Штрихкод", stock: "", unit: "", pack: "", multiplicity: "", supplierCode: "" },
  headerSignature: ["Наименование", "Цена", "Штрихкод"],
};

function tuple(name, price, barcode = "", supplierCode = "") {
  return ["Арнест", name, price, barcode, "", "шт", "arnest.xls", "4", "", "", supplierCode, ""];
}

function byName(state, name) {
  return rows.listRows(state.uploads).find((row) => row.name === name);
}

function statusOf(state, name) {
  const row = byName(state, name);
  return row ? state.matches[row.key]?.status ?? "" : "";
}

let state = storage.emptyState();
state = procurement.upsertSupplier(state, suppliers.createSupplier("Арнест", "arnest"));
state = {
  ...state,
  catalog: [
    { code: "4601111111111", name: "Порошок стиральный ABC автомат 3 кг", unit: "шт", barcode: "4601111111111" },
    { code: "4602222222222", name: "Дезодорант мужской 150 мл", unit: "шт", barcode: "4602222222222" },
    { code: "CLEAN", name: "ABC средство чистящее 0,5 л", unit: "шт", barcode: "" },
    { code: "OTHER", name: "Соль экстра", unit: "шт", barcode: "" },
  ],
};

const first = procurement.acceptCurrentPrice(state, {
  supplierId: "arnest",
  fileName: "arnest.xls",
  receivedAt: "2026-09-29T10:00:00.000Z",
  rows: [
    tuple("Порошок автомат 3 кг", 100, "4601111111111", "S-1"),
    tuple("Порошок автомат 3 кг", 90, "4602222222222", "S-2"),
    tuple("Средство ABC 500 мл", 80, "", "S-3"),
    tuple("Неизвестный товар поставщика 1", 10, "", "S-9"),
  ],
  mapper,
});
check("прайс принят", first.ok);
state = first.state;

const safeMatches = rows.listRows(state.uploads).filter((row) => row.name === "Порошок автомат 3 кг");
const proposed = safeMatches.find((row) => state.matches[row.key]?.code === "4601111111111");
const conflictSafe = safeMatches.find((row) => row.barcode === "4602222222222");
const proposedMatch = proposed ? state.matches[proposed.key] : null;
check("штрихкод даёт предложение и не подтверждает сам", Boolean(proposedMatch) && proposedMatch.status === "review" && proposedMatch.status !== "confirmed", proposedMatch ? `${proposedMatch.status} ${proposedMatch.confidence}` : "");
check("процент по штрихкоду высокий и настоящий", Boolean(proposedMatch) && proposedMatch.confidence >= 85 && proposedMatch.confidence <= 100, String(proposedMatch?.confidence));
check("процент показан числом", proposedMatch && format.confidenceLabel(proposedMatch.confidence) === `${proposedMatch.confidence}%` && format.confidenceLabel(0) === "—");
check("причина про штрихкод", Boolean(proposedMatch) && /штрихкод/i.test(proposedMatch.reason), proposedMatch?.reason ?? "");
check("конфликт штрихкода на проверке", conflictSafe && state.matches[conflictSafe.key].status === "review" && /существенно изменилось наименование/.test(state.matches[conflictSafe.key].reason), conflictSafe ? state.matches[conflictSafe.key].reason : "нет");
check("конфликт не подтверждён", !safeMatches.some((row) => state.matches[row.key]?.code === "4602222222222" && state.matches[row.key]?.status === "confirmed"));

const named = byName(state, "Средство ABC 500 мл");
check("без штрихкода не подтверждено само", named && state.matches[named.key].status !== "confirmed", named ? state.matches[named.key].status : "");
check("без штрихкода есть предложение", Boolean(named && state.matches[named.key].code));

const fresh = byName(state, "Неизвестный товар поставщика 1");
check("новый без соответствия нужно решить", fresh && state.matches[fresh.key].status === "need" && state.matches[fresh.key].code === "");

const codeOnly = matching.suggestMatch(
  { ...tuple("Совсем другой товар", 1, "", "S-1"), key: "x", supplierId: "arnest", supplier: "Арнест", name: "Совсем другой товар", price: 1, barcode: "", code: "S-1", unit: "шт", file: "", stock: "", pack: "", multiplicity: "", supplierCode: "S-1", volume: "" },
  matching.buildCatalogIndex(state.catalog),
);
check("код поставщика сам не подтверждает", codeOnly.status !== "confirmed");

const keep = proposed;
const rejectRow = byName(state, "Неизвестный товар поставщика 1");
state = memory.saveKnownMatch(state, keep.key, { status: "confirmed", code: "4601111111111", confidence: 100, reason: "вручную", relation: "exact" });
state = memory.rejectProduct(state, rejectRow.key);
state = memory.saveAbsent(state, named.key);

const again = procurement.acceptCurrentPrice(state, {
  supplierId: "arnest",
  fileName: "arnest-2.xls",
  receivedAt: "2026-09-29T12:00:00.000Z",
  rows: [
    tuple("Порошок стиральный ABC автомат 3000 г", 110, "4601111111111", "S-100"),
    tuple("Неизвестный товар поставщика 1", 10, "", "S-200"),
    tuple("Средство ABC 500 мл", 80, "", "S-300"),
    tuple("Порошок автомат 3 кг", 90, "4602222222222", "S-2"),
    tuple("Дезодорант мужской 150 мл", 50, "", "S-1"),
  ],
  mapper,
});
state = again.state;
const renamed = rows.listRows(state.uploads).find((row) => row.barcode === "4601111111111");
check("переименованный остаётся подтверждён", renamed && state.matches[renamed.key]?.status === "confirmed", renamed ? state.matches[renamed.key]?.status : "");
check("не работаем не в очереди", statusOf(state, "Неизвестный товар поставщика 1") === "rejected");
const need = rows.listRows(state.uploads).filter((row) => state.matches[row.key]?.status === "need").map((row) => row.name);
check("подтверждённый и отказ не в нужно решить", !need.some((name) => name.includes("Неизвестный") || name.includes("3000")), need.join(", "));
check("нет в каталоге сохранилось", rows.listRows(state.uploads).some((row) => state.matches[row.key]?.status === "missing"));
check("конфликт после повторной загрузки", rows.listRows(state.uploads).some((row) => row.barcode === "4602222222222" && state.matches[row.key]?.status === "review"));
const reusedCode = byName(state, "Дезодорант мужской 150 мл");
check(
  "тот же код поставщика на другой товар — на проверке",
  Boolean(reusedCode) && state.matches[reusedCode.key]?.status === "review" && state.matches[reusedCode.key]?.status !== "confirmed",
  reusedCode ? state.matches[reusedCode.key]?.reason : "",
);

check("пропуск не окончательное решение", format.confidenceLabel(64) === "64%" && format.passesFilter("skipped", "skipped") && !format.passesFilter("skipped", "resolved") && !format.passesFilter("skipped", "need"));
check("всё решено включает отказ и каталог", format.passesFilter("rejected", "resolved") && format.passesFilter("missing", "resolved") && !format.passesFilter("need", "resolved") && !format.passesFilter("review", "resolved"));

const holdName = "Временный товар без решения";
state = {
  ...state,
  uploads: state.uploads.map((upload, index) =>
    index === 0 ? { ...upload, rows: [...upload.rows, ["Арнест", holdName, 3, "", "", "шт", "arnest-2.xls", "1", "", "", "HOLD", ""]] } : upload,
  ),
};
state = matching.applyAutoMatch(state);
const hold = rows.listRows(state.uploads).find((row) => row.name === holdName);
state = matching.skipMatches(state, [hold.key]);
check("пропуск не пишется как запрет", state.matches[hold.key].status === "skipped" && !Object.values(state.productMemory).some((item) => item.traits.name === holdName));
const laterName = "Совершенно новый товар без истории";
state = {
  ...state,
  uploads: state.uploads.map((upload, index) =>
    index === 0 ? { ...upload, rows: [...upload.rows, ["Арнест", laterName, 1, "", "", "шт", "arnest-2.xls", "1", "", "", "NEW-1", ""]] } : upload,
  ),
};
state = matching.applyAutoMatch(state);
const held = rows.listRows(state.uploads).find((row) => row.name === holdName);
const appeared = rows.listRows(state.uploads).find((row) => row.name === laterName);
check("пропущенная позиция остаётся отложенной", held && state.matches[held.key]?.status === "skipped");
check("новый товар попадает в обработку", Boolean(appeared) && (state.matches[appeared.key]?.status === "need" || state.matches[appeared.key]?.status === "review"));
state = memory.rejectProducts(state, [appeared.key, held.key]);
check("массовый отказ запоминается", state.matches[appeared.key]?.status === "rejected");
check("пропуск не мешает позже отметить не работаем", state.matches[held.key]?.status === "rejected");

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки сопоставления пройдены");
