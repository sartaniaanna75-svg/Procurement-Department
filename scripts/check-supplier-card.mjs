import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const suppliers = await server.ssrLoadModule("/src/utils/suppliers.ts");
const procurement = await server.ssrLoadModule("/src/utils/procurement.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const memory = await server.ssrLoadModule("/src/utils/productMemory.ts");
const rows = await server.ssrLoadModule("/src/utils/rows.ts");

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

const card = suppliers.createSupplier("METRO", "sup-metro");
check("постоянный id", card.id === "sup-metro" && card.name === "METRO");
check("дни не обязательны", card.orderDays.length === 0 && card.purchaseMode === "schedule");

let state = storage.emptyState();
state = procurement.upsertSupplier(state, {
  ...card,
  fullName: "ООО МЕТРО Кэш энд Керри",
  comment: "Сайт",
  responsible: "Анна",
  offerSource: "site",
  purchaseMode: "demand",
  inns: ["7704218694"],
  aliases: ["Метро"],
  emails: ["order@metro.ru"],
  oneC: {
    ...card.oneC,
    partner: "Партнёр",
    partnerGuid: "g-partner",
    counterparty: "Контрагент",
    counterpartyGuid: "g-counter",
    agreement: "Соглашение",
    agreementGuid: "g-agr",
    contract: "Договор",
    contractGuid: "g-contract",
    organization: "Организация",
    organizationGuid: "g-org",
    guid: "g-supplier",
  },
});
const saved = state.suppliers[0];
check("источник сайт", saved.offerSource === "site");
check("режим потребность", saved.purchaseMode === "demand" && saved.orderDays.length === 0);
check("реквизиты 1С", saved.oneC.partnerGuid === "g-partner" && suppliers.oneCReady(saved));
check("статус 1С", suppliers.oneCStatusLabel(saved) === "Связь с 1С настроена");
const partial = { ...saved, oneC: { ...saved.oneC, contractGuid: "" } };
check("без GUID требуется настройка", suppliers.oneCStatusLabel(partial) === "Требуется настройка 1С");

for (const source of ["price", "site", "manual", "api"]) {
  state = procurement.upsertSupplier(state, { ...saved, offerSource: source });
  check(`источник ${source}`, state.suppliers[0].offerSource === source);
}
for (const mode of ["schedule", "demand", "manual", "mixed"]) {
  state = procurement.upsertSupplier(state, { ...state.suppliers[0], purchaseMode: mode, orderDays: mode === "manual" || mode === "demand" ? [] : [1] });
  check(`режим ${mode}`, state.suppliers[0].purchaseMode === mode);
}
state = procurement.upsertSupplier(state, { ...state.suppliers[0], purchaseMode: "manual", orderDays: [] });
check("ручной режим хранит пустые дни", state.suppliers[0].purchaseMode === "manual" && state.suppliers[0].orderDays.length === 0);

const round = storage.normalizeState(JSON.parse(JSON.stringify(state)));
check("после чтения карточка цела", round.suppliers[0].fullName.includes("МЕТРО") && round.suppliers[0].comment === "Сайт" && round.suppliers[0].id === "sup-metro");
check("старые данные без новых полей", storage.normalizeState({ suppliers: [{ id: "old", name: "АВС" }] }).suppliers[0].offerSource === "price" && storage.normalizeState({ suppliers: [{ id: "old", name: "АВС" }] }).suppliers[0].purchaseMode === "schedule");

const mapper = {
  headerRow: 1,
  name: 0,
  price: 1,
  barcode: -1,
  code: -1,
  unit: -1,
  stock: -1,
  pack: -1,
  multiplicity: -1,
  volume: -1,
  labels: { name: "Наименование", price: "Цена", barcode: "", stock: "", unit: "", pack: "", multiplicity: "", supplierCode: "" },
  headerSignature: ["Наименование", "Цена"],
};
const accepted = procurement.acceptCurrentPrice(round, {
  supplierId: "sup-metro",
  fileName: "metro.xls",
  receivedAt: "2026-10-02T12:00:00.000Z",
  rows: [["?", "Сахар", 10, "4600000000001", "", "шт", "metro.xls", "", "", "", "CODE-1", ""]],
  mapper,
  signals: { fileName: "metro.xls", email: "", companyNames: ["Торговый дом Север"], inns: ["7704218694"], sheetNames: [], structureHint: "" },
});
state = accepted.state;
check("прайс связан с id", state.uploads[0].supplierId === "sup-metro" && state.uploads[0].supplier === "METRO");
check("название из файла запомнено", state.suppliers[0].priceNames.includes("Торговый дом Север"));
const sugar = rows.listRows(state.uploads).find((row) => row.name === "Сахар");
state = memory.rejectProduct(state, sugar.key);
check("отказ привязан к id", Object.values(state.productMemory)[0].supplierId === "sup-metro");
const again = procurement.acceptCurrentPrice(state, {
  supplierId: "sup-metro",
  fileName: "metro-2.xls",
  receivedAt: "2026-10-03T12:00:00.000Z",
  rows: [["?", "Сахар песок", 11, "4600000000001", "", "шт", "metro-2.xls", "", "", "", "OTHER", ""]],
  mapper,
});
check("отказ жив после замены прайса", again.ok && rows.listRows(again.state.uploads).every((row) => again.state.matches[row.key]?.status === "rejected"));
check("память всё ещё на id", Object.values(again.state.productMemory).some((item) => item.supplierId === "sup-metro" && item.verdict === "rejected"));

const guess = suppliers.detectSupplier(
  { fileName: "заказ.xlsx", email: "order@metro.ru", companyNames: [], inns: [], sheetNames: [], structureHint: "" },
  again.state.suppliers,
  {},
);
check("узнаёт по email без имени файла", guess.supplierId === "sup-metro" && guess.confidence === "high", guess.confidence);
const byInn = suppliers.detectSupplier(
  { fileName: "list.xlsx", email: "", companyNames: [], inns: ["7704218694"], sheetNames: [], structureHint: "" },
  again.state.suppliers,
  {},
);
check("узнаёт по ИНН", byInn.supplierId === "sup-metro");

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки карточки поставщика пройдены");
