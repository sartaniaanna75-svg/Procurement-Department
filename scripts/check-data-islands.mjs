import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const persist = await server.ssrLoadModule("/src/utils/persist.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const update = await server.ssrLoadModule("/src/utils/catalogUpdate.ts");
const matching = await server.ssrLoadModule("/src/utils/matching.ts");
const procurement = await server.ssrLoadModule("/src/utils/procurement.ts");
const memory = await server.ssrLoadModule("/src/utils/productMemory.ts");
const suppliers = await server.ssrLoadModule("/src/utils/suppliers.ts");
const rows = await server.ssrLoadModule("/src/utils/rows.ts");

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

const arnest = { ...suppliers.createSupplier("Арнест", "arnest"), orderDays: [1] };
const peti = { ...suppliers.createSupplier("Петя", "peti"), orderDays: [2] };

let state = storage.normalizeState({
  ...storage.emptyState(),
  catalog: [
    { code: "C1", name: "АБС 1 л отбеливатель", unit: "шт", barcode: "8690511183853" },
    { code: "C2", name: "Сахар весовой", unit: "кг", barcode: "" },
  ],
  suppliers: [arnest, peti],
  uploads: [
    {
      file: "arnest.xls",
      supplier: "Арнест",
      supplierId: "arnest",
      uploadedAt: "2026-09-29T10:00:00.000Z",
      cycleDate: "2026-09-29",
      versionId: "ver-a1",
      rows: [["Арнест", "АВС 1 л отбеливатель", 100, "8690511183853", "", "шт", "", "", "", "", "", ""]],
    },
    {
      file: "peti.xls",
      supplier: "Петя",
      supplierId: "peti",
      uploadedAt: "2026-09-29T11:00:00.000Z",
      cycleDate: "2026-09-29",
      versionId: "ver-p1",
      rows: [["Петя", "Сахар", 50, "", "", "кг", "", "", "", "", "", ""]],
    },
  ],
});

const arnestBefore = state.uploads.find((item) => item.supplierId === "arnest");
const petiBefore = state.uploads.find((item) => item.supplierId === "peti");
check("есть прайсы двух поставщиков", Boolean(arnestBefore && petiBefore));

state = matching.applyAutoMatch(state);
const bleachRow = rows.listRows(state.uploads).find((row) => row.barcode === "8690511183853");
check("строка отбеливателя найдена", Boolean(bleachRow));
state = memory.saveKnownMatch(state, bleachRow.key, {
  status: "confirmed",
  code: "C1",
  confidence: 100,
  reason: "ручное",
  relation: "exact",
});
check("ручное сопоставление записано", state.matches[bleachRow.key]?.status === "confirmed" && state.matches[bleachRow.key]?.code === "C1");

const suppliersBefore = state.suppliers.map((card) => `${card.id}:${card.name}:${card.orderDays.join(",")}`).join("|");
const uploadsBefore = state.uploads.map((upload) => `${upload.supplierId}:${upload.versionId}:${upload.rows.length}`).join("|");

const catalog = update.mergeCatalog(state.catalog, [
  { code: "C1", name: "АБС 1 л отбеливатель", unit: "шт", barcode: "8690511183853" },
  { code: "C2", name: "Сахар весовой", unit: "кг", barcode: "" },
  { code: "C3", name: "Пакет большой", unit: "шт", barcode: "" },
]);
const reconciled = update.reconcileMatchesAfterCatalog({ ...state, catalog });
const afterCatalog = persist.keepSupplierPriceIslands(
  state,
  matching.applyAutoMatch(
    {
      ...reconciled,
      previousCatalog: state.catalog,
      catalogUpdatedAt: "2026-09-29T12:00:00.000Z",
    },
    { reconsiderAbsent: true },
  ),
);

check(
  "после обновления каталога прайсы на месте",
  afterCatalog.uploads.map((upload) => `${upload.supplierId}:${upload.versionId}:${upload.rows.length}`).join("|") === uploadsBefore,
);
check(
  "после обновления каталога поставщики на месте",
  afterCatalog.suppliers.map((card) => `${card.id}:${card.name}:${card.orderDays.join(",")}`).join("|") === suppliersBefore,
);
check("ручное сопоставление сохранено", afterCatalog.matches[bleachRow.key]?.status === "confirmed" && afterCatalog.matches[bleachRow.key]?.code === "C1");
check("товары без штрихкода в каталоге", afterCatalog.catalog.some((item) => item.code === "C3" && !item.barcode));

const changed = persist.changedPersistStores(persist.persistStoreFingerprints(state), persist.persistStoreFingerprints(afterCatalog));
check("обновление каталога не пишет store prices", !changed.includes("prices"), changed.join(","));
check("обновление каталога не пишет store suppliers", !changed.includes("suppliers"), changed.join(","));
check("обновление каталога пишет catalog", changed.includes("catalog"), changed.join(","));

const protectedState = persist.protectIndependentData({ ...afterCatalog, uploads: [], heldPrices: [], suppliers: [] }, afterCatalog);
check("защита не даёт стереть прайсы пустым состоянием", protectedState.uploads.length === afterCatalog.uploads.length);
check("защита не даёт стереть поставщиков", protectedState.suppliers.length === afterCatalog.suppliers.length);

const priceResult = procurement.acceptCurrentPrice(afterCatalog, {
  supplierId: "arnest",
  fileName: "arnest-new.xls",
  receivedAt: "2026-09-29T13:00:00.000Z",
  rows: [["Арнест", "АВС 1 л отбеливатель", 110, "8690511183853", "", "шт", "", "", "", "", "", ""]],
  mapper: {
    headerRow: 0,
    name: 1,
    price: 2,
    barcode: 3,
    code: -1,
    unit: 5,
    stock: -1,
    pack: -1,
    multiplicity: -1,
    labels: {},
    headerSignature: ["поставщик", "название", "цена", "штрихкод", "", "ед"],
  },
});
check("новый прайс Арнест принят", priceResult.ok, priceResult.reason);
const afterPrice = priceResult.state;
check(
  "прайс Пети не изменился",
  afterPrice.uploads.find((item) => item.supplierId === "peti")?.versionId === petiBefore.versionId &&
    afterPrice.uploads.find((item) => item.supplierId === "peti")?.rows.length === petiBefore.rows.length,
);
check("прайс Арнест обновился", afterPrice.uploads.find((item) => item.supplierId === "arnest")?.file === "arnest-new.xls");
check(
  "каталог не изменился при загрузке прайса",
  afterPrice.catalog.length === afterCatalog.catalog.length && afterPrice.catalog.every((item, index) => item.code === afterCatalog.catalog[index].code),
);

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки изоляции данных пройдены");
