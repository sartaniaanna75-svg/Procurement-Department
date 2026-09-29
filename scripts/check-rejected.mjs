import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const suppliers = await server.ssrLoadModule("/src/utils/suppliers.ts");
const procurement = await server.ssrLoadModule("/src/utils/procurement.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const rows = await server.ssrLoadModule("/src/utils/rows.ts");
const memory = await server.ssrLoadModule("/src/utils/productMemory.ts");
const matching = await server.ssrLoadModule("/src/utils/matching.ts");
const order = await server.ssrLoadModule("/src/utils/order.ts");

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
  return ["АВС", name, price, barcode, "", "шт", "price.xls", "4", "", "", supplierCode, ""];
}

function byName(state, name) {
  return rows.listRows(state.uploads).find((row) => row.name === name);
}

function statusOf(state, name) {
  const row = byName(state, name);
  return row ? state.matches[row.key]?.status ?? "" : "";
}

let state = storage.emptyState();
state = procurement.upsertSupplier(state, suppliers.createSupplier("АВС", "abc"));
state = {
  ...state,
  catalog: [
    { code: "SUGAR", name: "Сахар", unit: "шт" },
    { code: "GEL", name: "Гель для стирки", unit: "шт" },
  ],
};

const first = procurement.acceptCurrentPrice(state, {
  supplierId: "abc",
  fileName: "first.xls",
  receivedAt: "2026-10-02T12:00:00.000Z",
  rows: [
    tuple("ABC Гель для стирки Ромашка 1 л", 120, "4601111111111", "A-1"),
    tuple("Порошок стиральный без штрихкода 2 кг", 90, "", "A-2"),
    tuple("Сахар", 40, "4600000000001", "A-3"),
    tuple("Соль", 15, "", "A-4"),
  ],
  mapper,
});
check("прайс принят", first.ok);
state = first.state;

const gel = byName(state, "ABC Гель для стирки Ромашка 1 л");
const powder = byName(state, "Порошок стиральный без штрихкода 2 кг");
const sugar = byName(state, "Сахар");
state = memory.rejectProduct(state, gel.key);
state = memory.rejectProduct(state, powder.key);
state = memory.saveKnownMatch(state, sugar.key, { status: "confirmed", code: "SUGAR", confidence: 100, reason: "вручную" });

const needNames = rows.listRows(state.uploads).filter((row) => state.matches[row.key]?.status === "need").map((row) => row.name);
check("очередь без отказных", needNames.length === 1 && needNames[0] === "Соль", needNames.join(", "));
check("сахар сопоставлен", statusOf(state, "Сахар") === "confirmed");
check("память отдельно", Object.values(state.productMemory).filter((item) => item.verdict === "rejected").length === 2);

const memoryBefore = JSON.stringify(state.productMemory);
const replaced = procurement.acceptCurrentPrice(state, {
  supplierId: "abc",
  fileName: "second.xls",
  receivedAt: "2026-10-03T12:00:00.000Z",
  rows: [
    tuple("Гель д/стирки ABC Ромашка 1000 мл", 130, "4601111111111", "B-9"),
    tuple("Порошок стиральный без штрихкода 2кг", 95, "", "B-2"),
    tuple("Сахар-песок", 42, "4600000000001", "B-3"),
    tuple("Соль", 16, "", "B-4"),
    tuple("ABC Кондиционер Ромашка 1 л", 80, "4601111111111", "B-5"),
    tuple("Молоко 1 л", 70, "4603333333333", "B-6"),
  ],
  mapper,
});
check("новый прайс заменил", replaced.ok && replaced.state.uploads.length === 1 && replaced.state.uploads[0].file === "second.xls");
state = replaced.state;
check("отказ восстановился по штрихкоду", statusOf(state, "Гель д/стирки ABC Ромашка 1000 мл") === "rejected");
check("отказ восстановился по отпечатку", statusOf(state, "Порошок стиральный без штрихкода 2кг") === "rejected");
check("сопоставление восстановилось", statusOf(state, "Сахар-песок") === "confirmed" && byName(state, "Сахар-песок") && state.matches[byName(state, "Сахар-песок").key].code === "SUGAR");
check("противоречие на проверке", statusOf(state, "ABC Кондиционер Ромашка 1 л") === "review");
check("противоречие не отказ", !Object.values(state.productMemory).some((item) => item.verdict === "rejected" && item.traits.name.includes("Кондиционер")));
check("неизвестная соль в очереди", statusOf(state, "Соль") === "need");
check("новое молоко в очереди", statusOf(state, "Молоко 1 л") === "need");
const queue = rows.listRows(state.uploads).filter((row) => state.matches[row.key]?.status === "need" || state.matches[row.key]?.status === "review").map((row) => row.name);
check("в разборе только новые и спорные", queue.length === 3, queue.join(", "));
check("память жива после замены", Object.values(state.productMemory).filter((item) => item.verdict === "rejected").length === 2);
check("переименованный отказ не числится пропавшим", (state.notInPrice.abc ?? []).every((item) => !item.name.includes("Гель") && !item.name.includes("Порошок")));

const broken = procurement.acceptCurrentPrice(state, {
  supplierId: "abc",
  fileName: "broken.xls",
  receivedAt: "2026-10-03T13:00:00.000Z",
  rows: [],
  mapper,
});
check("битый прайс не стирает отказ", broken.ok === false && broken.state.uploads[0].file === "second.xls" && JSON.stringify(broken.state.productMemory) === JSON.stringify(state.productMemory));

const gelMemory = Object.values(state.productMemory).find((item) => item.verdict === "rejected" && item.traits.barcode === "4601111111111");
state = matching.applyAutoMatch(memory.releaseProduct(state, gelMemory.id));
check("возврат в работу", statusOf(state, "Гель д/стирки ABC Ромашка 1000 мл") === "need");
check("отказ снят", !Object.values(state.productMemory).some((item) => item.traits.barcode === "4601111111111" && item.verdict === "rejected"));

const conditioner = byName(state, "ABC Кондиционер Ромашка 1 л");
state = matching.dismissReview(state, conditioner.key);
check("другой товар ушёл из проверки", statusOf(state, "ABC Кондиционер Ромашка 1 л") === "need");
state = matching.applyAutoMatch(state);
check("проверка не возвращается сама", statusOf(state, "ABC Кондиционер Ромашка 1 л") === "need");

const saved = storage.normalizeState(JSON.parse(JSON.stringify(state)));
check("решение сохраняется при чтении", Object.values(saved.productMemory).some((item) => item.verdict === "rejected" && item.traits.name.includes("Порошок")));
check("память не внутри прайса", !JSON.stringify(saved.uploads).includes("ArrayBuffer") && saved.uploads[0].rows.length === 6);

const again = procurement.acceptCurrentPrice(saved, {
  supplierId: "abc",
  fileName: "third.xls",
  receivedAt: "2026-10-04T12:00:00.000Z",
  rows: [tuple("Порошок стиральный без штрихкода 2 кг", 99, "", "C-1"), tuple("Сахар-песок", 41, "4600000000001", "C-3")],
  mapper,
});
check("после перечитывания отказ на месте", again.ok && statusOf(again.state, "Порошок стиральный без штрихкода 2 кг") === "rejected");
check("после перечитывания сопоставление на месте", statusOf(again.state, "Сахар-песок") === "confirmed");

const draft = order.buildOrder(again.state);
check("отказ не в заказе", draft.lines.every((line) => line.code !== "GEL") && draft.lines.some((line) => line.code === "SUGAR"));
check("исходная память не потеряна", memoryBefore.includes("не работаем") || memoryBefore.includes("rejected"));

let scent = storage.emptyState();
scent = procurement.upsertSupplier(scent, suppliers.createSupplier("АВС", "abc"));
scent = procurement.acceptCurrentPrice(scent, {
  supplierId: "abc",
  fileName: "scent.xls",
  receivedAt: "2026-10-02T12:00:00.000Z",
  rows: [
    tuple("Гель для мытья посуды ABC Апельсин 750 GR", 10, "", "S-1"),
    tuple("Гель для мытья посуды ABC Лимон 750 гр", 11, "", "S-2"),
  ],
  mapper,
}).state;
scent = memory.rejectProduct(scent, byName(scent, "Гель для мытья посуды ABC Апельсин 750 GR").key);
scent = memory.rejectProduct(scent, byName(scent, "Гель для мытья посуды ABC Лимон 750 гр").key);
check("разные ароматы хранятся отдельно", Object.values(scent.productMemory).filter((item) => item.verdict === "rejected").length === 2);
scent = procurement.acceptCurrentPrice(scent, {
  supplierId: "abc",
  fileName: "scent-new.xls",
  receivedAt: "2026-10-03T12:00:00.000Z",
  rows: [
    tuple("Гель для мытья посуды ABC Апельсин 750гр", 12, "", "S-9"),
    tuple("Гель для мытья посуды ABC Лимон 750 GR", 13, "", "S-8"),
  ],
  mapper,
}).state;
check("апельсин остался отказом", statusOf(scent, "Гель для мытья посуды ABC Апельсин 750гр") === "rejected");
check("лимон остался своим отказом", statusOf(scent, "Гель для мытья посуды ABC Лимон 750 GR") === "rejected");

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки «не работаем» пройдены");
