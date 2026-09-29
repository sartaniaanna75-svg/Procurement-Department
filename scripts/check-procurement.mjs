import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const suppliers = await server.ssrLoadModule("/src/utils/suppliers.ts");
const procurement = await server.ssrLoadModule("/src/utils/procurement.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const rows = await server.ssrLoadModule("/src/utils/rows.ts");

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

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

function tuple(supplier, name, price, barcode = "") {
  return [supplier, name, price, barcode, "", "шт", "price.xls", "", "", "", "", ""];
}

function mondayCard(name, id) {
  const card = suppliers.createSupplier(name, id);
  card.orderDays = [1];
  card.schedule.deadlineTime = "09:00";
  card.schedule.deadlineWeekday = 1;
  return card;
}

let state = storage.emptyState();
const petya = mondayCard("Петя", "petya");
state = procurement.upsertSupplier(state, petya);
check("1 карточка", state.suppliers.length === 1 && state.suppliers[0].name === "Петя");
check("2 один день", state.suppliers[0].orderDays.length === 1 && state.suppliers[0].orderDays[0] === 1);

const vasya = suppliers.createSupplier("Вася", "vasya");
vasya.orderDays = [1, 4];
vasya.schedule.deadlineTime = "09:00";
state = procurement.upsertSupplier(state, vasya);
check("3 несколько дней", state.suppliers.find((card) => card.id === "vasya").orderDays.join(",") === "1,4");

const friday = new Date(2026, 9, 2, 15, 0, 0).toISOString();
const saturday = new Date(2026, 9, 3, 12, 0, 0).toISOString();
let accepted = procurement.acceptCurrentPrice(state, {
  supplierId: "petya",
  fileName: "friday.xls",
  receivedAt: friday,
  rows: [tuple("Петя", "Сахар", 100, "4600000000001"), tuple("Петя", "Соль", 40)],
  mapper,
});
check("4 цикл понедельника", accepted.ok && accepted.cycleDate === "2026-10-05", accepted.cycleDate);
check("4 текст", accepted.reason.includes("02.10") && accepted.reason.includes("05.10") && accepted.reason.includes("Готов к заказу"), accepted.reason);
state = accepted.state;

const sugarKey = rows.matchKey("Петя", "Сахар", "", "4600000000001", "шт");
state = {
  ...state,
  matches: { ...state.matches, [sugarKey]: { status: "confirmed", code: "SUGAR", confidence: 100, reason: "вручную" } },
};

accepted = procurement.acceptCurrentPrice(state, {
  supplierId: "petya",
  fileName: "saturday.xls",
  receivedAt: saturday,
  rows: [tuple("Петя", "Соль", 42)],
  mapper,
});
state = accepted.state;
const current = state.uploads.filter((upload) => upload.supplierId === "petya");
check("5 один актуальный прайс", current.length === 1 && current[0].file === "saturday.xls");
check("5 тот же цикл", current[0].cycleDate === "2026-10-05");
check("7 сопоставление сохранено", state.matches[sugarKey]?.status === "confirmed" && state.matches[sugarKey]?.code === "SUGAR");
check("7 нет в прайсе", (state.notInPrice.petya ?? []).some((item) => item.name === "Сахар"));
check("7 остаток не ноль", !current[0].rows.some((row) => row[1] === "Сахар" && row[7] === "0"));

const broken = procurement.acceptCurrentPrice(state, {
  supplierId: "petya",
  fileName: "broken.xls",
  receivedAt: saturday,
  rows: [],
  mapper,
});
check("6 повреждённый не затирает", broken.ok === false && broken.state.uploads.find((upload) => upload.supplierId === "petya")?.file === "saturday.xls");

accepted = procurement.acceptCurrentPrice({ ...broken.state, catalog: [{ code: "SUGAR", name: "Сахар", unit: "шт" }] }, {
  supplierId: "petya",
  fileName: "sunday.xls",
  receivedAt: new Date(2026, 9, 4, 11, 0, 0).toISOString(),
  rows: [tuple("Петя", "Сахар", 119, "4600000000001"), tuple("Петя", "Соль", 42)],
  mapper,
});
state = accepted.state;
check("8 товар вернулся", state.uploads.find((upload) => upload.supplierId === "petya").rows.some((row) => row[1] === "Сахар"));
check("8 сопоставление на месте", state.matches[sugarKey]?.code === "SUGAR" && state.matches[sugarKey]?.status === "confirmed");
check("8 снова в прайсе", (state.notInPrice.petya ?? []).every((item) => item.name !== "Сахар"));
check("история цены", (state.priceHistory[sugarKey] ?? []).some((point) => point.price === 119));

const sasha = mondayCard("Саша", "sasha");
sasha.responsible = "Оля";
state = procurement.upsertSupplier(state, sasha);
const morning = procurement.procurementBoard(state, new Date(2026, 9, 5, 8, 0, 0));
const sashaMorning = morning.expected.find((item) => item.supplierId === "sasha");
check("9 ожидаем прайс", sashaMorning?.freshness === "expected" && sashaMorning.text === "Ожидаем прайс" && sashaMorning.level === "waiting", sashaMorning?.text);
check("9 ожидаем не дублируется в сегодня", !morning.today.some((item) => item.supplierId === "sasha" && item.cycleDate === sashaMorning?.cycleDate));
const late = procurement.procurementBoard(state, new Date(2026, 9, 5, 10, 0, 0));
const sashaLate = late.missing.find((item) => item.supplierId === "sasha");
check("9 нет прайса", sashaLate?.freshness === "missing" && sashaLate.text === "Нет актуального прайса к закупке" && sashaLate.level === "critical", sashaLate?.text);
check("9 просрочка не дублируется в сегодня", !late.today.some((item) => item.supplierId === "sasha" && item.cycleDate === sashaLate?.cycleDate));
check("9 ответственный", sashaLate?.responsible === "Оля");
check("9 ожидался", Boolean(sashaLate?.expectedAt));

check("10 без 1С прайс жив", accepted.ok && suppliers.oneCReady(state.suppliers.find((card) => card.id === "petya")) === false);
check("10 статус", suppliers.oneCStatusLabel(state.suppliers.find((card) => card.id === "petya")) === "Требуется настройка 1С");
const linked = { ...state.suppliers.find((card) => card.id === "petya") };
linked.oneC = { name: "Петя", guid: "g1", partner: "П", partnerGuid: "g2", counterparty: "К", counterpartyGuid: "g3", agreement: "С", agreementGuid: "g4", contract: "Д", contractGuid: "g5", organization: "О", organizationGuid: "g6" };
check("10 связь настроена", suppliers.oneCReady(linked) && suppliers.canSendOrderToOneC(linked));

const wednesday = procurement.orderCycleDate([1, 4], new Date(2026, 9, 7, 12, 0, 0), vasya.schedule);
check("ближайший четверг", wednesday === "2026-10-08", wednesday);

const draftState = {
  ...broken.state,
  draftOrders: [{ id: "d1", supplierId: "petya", cycleDate: "2026-10-05", priceVersionId: broken.state.uploads.find((upload) => upload.supplierId === "petya").versionId, status: "draft", createdAt: saturday }],
};
const afterDraft = procurement.acceptCurrentPrice(draftState, {
  supplierId: "petya",
  fileName: "newer.xls",
  receivedAt: new Date(2026, 9, 4, 18, 0, 0).toISOString(),
  rows: [tuple("Петя", "Соль", 45)],
  mapper,
});
check("черновик не пересчитан", afterDraft.state.draftOrders[0].priceVersionId === draftState.draftOrders[0].priceVersionId);
check("отметка о новом прайсе", afterDraft.state.priceWatch.length === 1);
check("старая версия удержана", afterDraft.state.heldPrices.length === 1 && afterDraft.state.uploads.filter((upload) => upload.supplierId === "petya").length === 1);

const guessed = suppliers.detectSupplier(
  { fileName: "Прайс Петя.xls", email: "petya@shop.ru", companyNames: [], inns: [], sheetNames: [], structureHint: "" },
  [{ ...petya, emails: ["petya@shop.ru"] }],
  {},
);
check("автоопределение", guessed.confidence === "high" && guessed.supplierId === "petya", guessed.confidence);

const migrated = storage.normalizeState({
  catalog: [{ code: "1", name: "Сахар", unit: "шт" }],
  matches: { [sugarKey]: { status: "confirmed", code: "SUGAR", confidence: 100, reason: "" } },
  uploads: [
    { file: "old.xls", supplier: "Петя", uploadedAt: "2026-09-01T10:00:00.000Z", rows: [tuple("Петя", "Сахар", 90), tuple("Петя", "Чай", 10)] },
    { file: "new.xls", supplier: "Петя", uploadedAt: "2026-09-20T10:00:00.000Z", rows: [tuple("Петя", "Сахар", 100)] },
  ],
});
check("каталог сохранён", migrated.catalog.length === 1 && migrated.catalog[0].code === "1");
check("сопоставление при миграции", migrated.matches[sugarKey]?.code === "SUGAR");
check("в базе один рабочий прайс", migrated.uploads.length === 1 && migrated.uploads[0].file === "new.xls");
check("миграция без нулевого остатка", migrated.notInPrice[migrated.uploads[0].supplierId].some((item) => item.name === "Чай"));

const fridayNow = new Date(2026, 9, 2, 15, 0, 0);
const mondayNow = new Date(2026, 9, 5, 11, 0, 0);
const modes = storage.emptyState();
let petyaPlan = suppliers.createSupplier("Петя", "plan-petya");
petyaPlan.orderDays = [1];
petyaPlan.purchaseMode = "schedule";
petyaPlan.offerSource = "price";
petyaPlan.responsible = "Анна";
let plan = procurement.upsertSupplier(modes, petyaPlan);
const fridayPrice = procurement.acceptCurrentPrice(plan, {
  supplierId: "plan-petya",
  fileName: "friday.xls",
  receivedAt: friday,
  rows: [tuple("Петя", "Сахар", 100, "4600000000001")],
  mapper,
});
plan = fridayPrice.state;
const mondayBoard = procurement.procurementBoard(plan, mondayNow);
const petyaMonday = mondayBoard.today.find((item) => item.supplierId === "plan-petya");
check("с1 пятница на понедельник", fridayPrice.cycleDate === "2026-10-05" && petyaMonday?.freshness === "received" && petyaMonday.text === "Прайс получен", petyaMonday?.text);
check("с1 ближайший понедельник", procurement.nextOrderDate([1], fridayNow, petyaPlan.schedule) === "2026-10-05");

const sundayPrice = procurement.acceptCurrentPrice(plan, {
  supplierId: "plan-petya",
  fileName: "sunday.xls",
  receivedAt: new Date(2026, 9, 4, 11, 0, 0).toISOString(),
  rows: [tuple("Петя", "Сахар", 130, "4600000000001")],
  mapper,
});
const sundayCurrent = sundayPrice.state.uploads.filter((upload) => upload.supplierId === "plan-petya");
check("с2 воскресный прайс текущий", sundayCurrent.length === 1 && sundayCurrent[0].file === "sunday.xls");
check("с2 понедельник берёт воскресенье", procurement.procurementBoard(sundayPrice.state, mondayNow).today.find((item) => item.supplierId === "plan-petya")?.receivedAt === sundayPrice.state.uploads[0].uploadedAt);

const keptFriday = procurement.acceptCurrentPrice(plan, {
  supplierId: "plan-petya",
  fileName: "broken-sunday.xls",
  receivedAt: new Date(2026, 9, 4, 11, 0, 0).toISOString(),
  rows: [],
  mapper,
});
check("с3 повреждённый не стирает пятницу", keptFriday.ok === false && keptFriday.state.uploads.find((upload) => upload.supplierId === "plan-petya")?.file === "friday.xls");

let vasyaPlan = suppliers.createSupplier("Вася", "plan-vasya");
vasyaPlan.orderDays = [2];
vasyaPlan.purchaseMode = "schedule";
vasyaPlan.offerSource = "price";
vasyaPlan.responsible = "Олег";
vasyaPlan.schedule.deadlineWeekday = 2;
vasyaPlan.schedule.deadlineTime = "09:00";
let vasyaState = procurement.upsertSupplier(storage.emptyState(), vasyaPlan);
const tuesdayLate = new Date(2026, 9, 6, 10, 0, 0);
const vasyaItem = procurement.procurementBoard(vasyaState, tuesdayLate).missing.find((item) => item.supplierId === "plan-vasya");
check("с4 нет прайса к закупке", vasyaItem?.text === "Нет актуального прайса к закупке" && vasyaItem.cycleDate === "2026-10-06" && vasyaItem.responsible === "Олег", vasyaItem?.text);

let vtc = suppliers.createSupplier("VTC Group", "vtc");
vtc.purchaseMode = "demand";
vtc.offerSource = "price";
vtc.orderDays = [1];
let vtcState = procurement.upsertSupplier(storage.emptyState(), vtc);
const quiet = procurement.procurementBoard(vtcState, mondayNow);
check("с5 без потребности нет ошибки", !quiet.missing.some((item) => item.supplierId === "vtc") && quiet.demand.length === 0 && quiet.today.length === 0);
vtcState = procurement.setPurchaseNeed(vtcState, "vtc", true);
const needed = procurement.procurementBoard(vtcState, mondayNow).demand.find((item) => item.supplierId === "vtc");
check("с6 есть потребность", needed?.text === "Есть потребность — требуется актуальный прайс" && needed.timing === "on_demand", needed?.text);
check("с6 не в списке просрочки графика", !procurement.procurementBoard(vtcState, mondayNow).missing.some((item) => item.supplierId === "vtc"));

let metro = suppliers.createSupplier("METRO", "metro");
metro.offerSource = "site";
metro.purchaseMode = "schedule";
metro.orderDays = [1];
const metroBoard = procurement.procurementBoard(procurement.upsertSupplier(storage.emptyState(), metro), mondayNow);
check("с7 сайт без файла", metroBoard.today.some((item) => item.supplierId === "metro" && item.freshness === "not_required") && metroBoard.missing.length === 0);

let manualSource = suppliers.createSupplier("Ручной источник", "hand-source");
manualSource.offerSource = "manual";
manualSource.purchaseMode = "schedule";
manualSource.orderDays = [1];
const handBoard = procurement.procurementBoard(procurement.upsertSupplier(storage.emptyState(), manualSource), mondayNow);
check("с8 ручной источник", handBoard.missing.length === 0 && handBoard.expected.length === 0 && handBoard.today[0]?.freshness === "not_required");

let manualMode = suppliers.createSupplier("Ручной режим", "hand-mode");
manualMode.offerSource = "price";
manualMode.purchaseMode = "manual";
manualMode.orderDays = [1];
const manualBoard = procurement.procurementBoard(procurement.upsertSupplier(storage.emptyState(), manualMode), tuesdayLate);
check("с8 ручной режим без просрочки", manualBoard.today.length === 0 && manualBoard.missing.length === 0 && manualBoard.expected.length === 0);

let reminded = suppliers.createSupplier("Напоминание", "remind");
reminded.orderDays = [1];
reminded.schedule.deadlineWeekday = 1;
reminded.schedule.deadlineTime = "09:00";
reminded.schedule.reminders = [{ id: "r2", hoursBeforeDeadline: 2 }];
const remindBoard = procurement.procurementBoard(procurement.upsertSupplier(storage.emptyState(), reminded), new Date(2026, 9, 5, 8, 0, 0));
const remindItem = remindBoard.expected.find((item) => item.supplierId === "remind");
check("напоминание", remindItem?.reminder === true && remindItem.text === "Ожидаем прайс" && remindItem.level === "attention", remindItem?.text);
check("напоминание не дублируется в сегодня", !remindBoard.today.some((item) => item.supplierId === "remind"));

let atlant = suppliers.createSupplier("атлант", "atlant");
atlant.orderDays = [5];
atlant.purchaseMode = "schedule";
atlant.offerSource = "price";
atlant.schedule.deadlineWeekday = 5;
atlant.schedule.deadlineTime = "23:59";
const atlantNow = new Date(2026, 8, 30, 12, 0, 0);
const atlantBoard = procurement.procurementBoard(procurement.upsertSupplier(storage.emptyState(), atlant), atlantNow);
const atlantExpected = atlantBoard.expected.filter((item) => item.supplierId === "atlant");
const atlantUpcoming = atlantBoard.upcoming.filter((item) => item.supplierId === "atlant");
check("CZ-09.1 событие один раз в ожидается", atlantExpected.length === 1 && atlantExpected[0].cycleDate === "2026-10-02", atlantExpected[0]?.cycleDate);
check("CZ-09.1 то же событие не в ближайших", atlantUpcoming.length === 0);
check("CZ-09.1 одна карточка поставщика", procurement.upsertSupplier(storage.emptyState(), atlant).suppliers.length === 1);

const several = procurement.nextOrderDate([1, 4], new Date(2026, 9, 2, 12, 0, 0), petyaPlan.schedule);
check("несколько дней ближайший понедельник", several === "2026-10-05", several);

let staleCard = suppliers.createSupplier("Старый прайс", "stale");
staleCard.orderDays = [1];
staleCard.schedule.validityDays = 1;
let staleState = procurement.upsertSupplier(storage.emptyState(), staleCard);
staleState = procurement.acceptCurrentPrice(staleState, {
  supplierId: "stale",
  fileName: "friday.xls",
  receivedAt: friday,
  rows: [tuple("Старый прайс", "Сахар", 10)],
  mapper,
}).state;
const staleItem = procurement.procurementBoard(staleState, mondayNow).missing.find((item) => item.supplierId === "stale");
check("прайс устарел", staleItem?.freshness === "stale" && staleItem.text === "Прайс устарел", staleItem?.text);

const roundNeed = storage.normalizeState({ suppliers: [vtc], purchaseNeed: { vtc: true } });
check("потребность сохраняется в состоянии", roundNeed.purchaseNeed.vtc === true && procurement.hasPurchaseNeed(roundNeed, "vtc"));

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки закупок пройдены");
