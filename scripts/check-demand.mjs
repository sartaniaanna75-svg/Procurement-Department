/**
 * CZ-10: тесты модуля потребности (парсинг, кратность, формула, изоляция решений).
 * Запуск: node scripts/check-demand.mjs
 */
import { createServer } from "vite";

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const pack = await server.ssrLoadModule("/src/utils/demand/packSize.ts");
const calc = await server.ssrLoadModule("/src/utils/demand/calculate.ts");
const parse = await server.ssrLoadModule("/src/utils/demand/parseReports.ts");
const match = await server.ssrLoadModule("/src/utils/demand/matchCatalog.ts");
const build = await server.ssrLoadModule("/src/utils/demand/buildLines.ts");
const types = await server.ssrLoadModule("/src/utils/demand/types.ts");

check("упаковка *52", pack.extractPackMultiplicity("Майонез Байсад 150г*52") === 52);
check("упаковка *12", pack.extractPackMultiplicity("Аджика Кормилица 250г*12") === 12);
check("упаковка *72", pack.extractPackMultiplicity("Чай Нури цейлонский*72") === 72);
check("без упаковки", pack.extractPackMultiplicity("Сахар весовой") === null);
check("не брать *1", pack.extractPackMultiplicity("Тест*1") === null);
check("override", pack.resolvePackMultiplicity("Сахар", 24) === 24);

const result = calc.calculateDemand({
  name: "Майонез Байсад 150г*52",
  available: 121,
  onHand: 121,
  expected: 0,
  avgDaily: 11.565,
  stockDays: null,
  includeExpectedReceipts: false,
});
check("запас дней", Math.abs((result.stockDaysShown ?? 0) - 121 / 11.565) < 0.01);
check("7 дней = 0", result.scenarios[7].qty === 0);
check("21 день упаковки", result.scenarios[21].packs === 3 && result.scenarios[21].qty === 156, JSON.stringify(result.scenarios[21]));
check("30 дней упаковки", result.scenarios[30].packs === 5 && result.scenarios[30].qty === 260, JSON.stringify(result.scenarios[30]));

const withExpected = calc.calculateDemand({
  name: "Майонез Байсад 150г*52",
  available: 121,
  onHand: 121,
  expected: 100,
  avgDaily: 11.565,
  stockDays: null,
  includeExpectedReceipts: true,
});
check("ожидается уменьшает потребность", withExpected.scenarios[21].qty < result.scenarios[21].qty);

const stockMatrix = [
  ["Номенклатура", "Код", "Штрихкод", "В наличии", "Доступно", "Ожидается", "Дефицит"],
  ["Майонез Байсад 150г*52", "C1", "4600000000001", "121", "121", "0", ""],
  ["Чай Нури*72", "C2", "", "10", "8", "5", ""],
  ["Итого", "", "", "131", "129", "5", ""],
];
const stock = parse.parseStockReport(stockMatrix, "ostatki.xlsx");
check("остатки строк", stock.rows.length === 2);
check("остатки доступно", stock.rows[0].available === 121);
check("остатки в наличии", stock.rows[0].onHand === 121);

const turnMatrix = [
  ["Период: 01.07.2026–30.09.2026"],
  ["Номенклатура", "Код", "Потребление", "Среднедневное потребление", "Уровень запасов в днях", "Остаток на конец периода"],
  ["Майонез Байсад 150г*52", "C1", "1040", "11,565", "10,5", "121"],
  ["Чай Нури*72", "C2", "100", "1.1", "9", "10"],
];
const turn = parse.parseTurnoverReport(turnMatrix, "oborot.xlsx");
check("оборачиваемость строк", turn.rows.length === 2);
check("среднедневное из отчёта", turn.rows[0].avgDaily === 11.565, String(turn.rows[0].avgDaily));
check("период распознан", turn.meta.periodLabel.includes("01.07.2026"), turn.meta.periodLabel);

const catalog = [
  { code: "C1", name: "Майонез Байсад 150г*52", unit: "шт", barcode: "4600000000001" },
  { code: "C2", name: "Чай Нури*72", unit: "шт", barcode: "" },
];
const indexes = match.buildCatalogIndexes(catalog);
check("матч по коду", match.matchIdentityToCatalog({ code: "C1", barcode: "", name: "x" }, indexes).method === "code");
check("матч по штрихкоду", match.matchIdentityToCatalog({ code: "", barcode: "4600000000001", name: "x" }, indexes).method === "barcode");
check("матч по имени", match.matchIdentityToCatalog({ code: "", barcode: "", name: "Чай Нури*72" }, indexes).method === "name");

const workspace = {
  ...types.emptyDemandWorkspace(),
  stock: stock.rows,
  turnover: turn.rows,
  packOverrides: {},
  decisions: {},
  includeExpectedReceipts: false,
};
const { lines, unmatched } = build.buildDemandLines(workspace, catalog);
check("собраны линии", lines.length === 2);
check("нет несопоставленных", unmatched.length === 0);
const mayo = lines.find((line) => line.catalogCode === "C1");
check("mayo 21d", mayo?.calc.scenarios[21].packs === 3);

const foreign = build.buildDemandLines(types.emptyDemandWorkspace(), catalog);
check("без отчётов пусто", foreign.lines.length === 0);

await server.close();

if (failures.length) {
  console.error("FAILED:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("\nAll CZ-10 demand checks passed.");
