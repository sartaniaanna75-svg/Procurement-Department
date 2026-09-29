import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const update = await server.ssrLoadModule("/src/utils/catalogUpdate.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const memory = await server.ssrLoadModule("/src/utils/productMemory.ts");
const matching = await server.ssrLoadModule("/src/utils/matching.ts");
const rows = await server.ssrLoadModule("/src/utils/rows.ts");

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

const finance = [
  ["р/сч РНКБ опт", "567161", "2230186"],
  ["Касса ОПТ", "0", "5805900"],
  ["ИТОГО", "0", ""],
];
check("чужой файл отклонён", !update.inspectCatalog(finance, []).ok);

const current = [
  { code: "00-00000072", name: "Мыло", unit: "шт", barcode: "4605645006507" },
  { code: "00-00000074", name: "Сода", unit: "шт", barcode: "" },
  { code: "00-00000086", name: "Старый товар", unit: "шт", barcode: "4600000000008" },
];
const proper = [
  ["Код", "Наименование", "Штрихкод", "Ед. изм."],
  ["00-00000072", "Мыло хозяйственное", "4605645006507", "шт"],
  ["00-00000074", "Сода", "", "шт"],
  ["00-00000999", "Новый товар", "4.605645006508e+12", "шт"],
  ["", "", "", ""],
  ["00-00000111", "", "4600000000015", "шт"],
];
const previewWrap = update.inspectCatalog(proper, current, "nomen.xlsx");
check("правильный файл читается", previewWrap.ok);
const preview = previewWrap.ok ? previewWrap.preview : null;
if (preview) {
  check("найдено 3 товара", preview.found === 3, String(preview.found));
  check("со штрихкодом 2", preview.withBarcode === 2);
  check("без штрихкода 1", preview.withoutBarcode === 1);
  check("колонка наименования", preview.nameHeader === "Наименование");
  check("колонка штрихкода", preview.barcodeHeader === "Штрихкод");
  check("строка без названия отброшена", preview.skipped === 1);
  check("научная запись раскрыта", preview.items.some((item) => item.barcode === "4605645006508"));
}

const headerless = [
  ["АБС кондиционер 1 л", "8690511183853"],
  ["Сахар весовой", ""],
  ["Пакет большой", ""],
];
const plain = update.inspectCatalog(headerless, []);
check("файл без заголовков читается", plain.ok && plain.preview.found === 3);
if (plain.ok) {
  check("товар без штрихкода сохраняется", plain.preview.items.some((item) => item.name.includes("Сахар") && !item.barcode));
  check("режим по содержимому", plain.preview.meta.mode === "content");
}

check("ведущий ноль сохраняется", update.barcodeFromCell("04605645006507") === "04605645006507");
check("пустая ячейка не становится штрихкодом", update.barcodeFromCell("") === "" && update.barcodeFromCell("0") === "");
check("сильное уменьшение", update.shrinkRisk(13340, 37) === "severe");

const merged = update.mergeCatalog(current, [
  { code: "00-00000072", name: "Мыло хозяйственное", unit: "шт", barcode: "4605645006507" },
]);
check("старые позиции не пропадают из каталога", merged.length === 3);

let state = storage.emptyState();
state = {
  ...state,
  catalog: current,
  uploads: [
    {
      file: "arnest.xls",
      supplier: "Арнест",
      supplierId: "arnest",
      uploadedAt: "2026-09-29T10:00:00.000Z",
      cycleDate: "",
      versionId: "v1",
      rows: [["Арнест", "Мыло", 10, "4605645006507", "", "шт", "arnest.xls", "", "", "", "S-1", ""]],
    },
  ],
};
state = matching.applyAutoMatch(state);
const row = rows.listRows(state.uploads)[0];
state = memory.saveKnownMatch(state, row.key, { status: "confirmed", code: "00-00000072", confidence: 100, reason: "вручную", relation: "exact" });
const nextCatalog = update.mergeCatalog(state.catalog, [
  { code: "00-00000072", name: "Мыло", unit: "шт", barcode: "4605645006507" },
]);
const updated = matching.applyAutoMatch(update.reconcileMatchesAfterCatalog({ ...state, catalog: nextCatalog }));
check("подтверждение пережило обновление", updated.matches[row.key]?.status === "confirmed");

const index = matching.buildCatalogIndex([
  { code: "A", name: "АБС 1л отбеливатель", unit: "шт", barcode: "8690511183853" },
]);
const supplierRow = {
  key: "x",
  supplierId: "s",
  supplier: "S",
  name: "АВС 1л отбеливатель",
  price: 1,
  barcode: "8690511183853",
  code: "",
  unit: "шт",
  file: "",
  stock: "",
  pack: "",
  multiplicity: "",
  supplierCode: "",
  volume: "",
};
const hit = matching.suggestMatch(supplierRow, index);
check("точный уникальный штрихкод 100%", hit.confidence === 100 && hit.reason === "Точный штрихкод", `${hit.confidence} ${hit.reason}`);

const dupIndex = matching.buildCatalogIndex([
  { code: "A", name: "Товар 1", unit: "шт", barcode: "8690511183853" },
  { code: "B", name: "Товар 2", unit: "шт", barcode: "8690511183853" },
]);
const dupHit = matching.suggestMatch(supplierRow, dupIndex);
check("дубликат штрихкода не подтверждается", dupHit.code === "" && /нескольк/i.test(dupHit.reason), dupHit.reason);

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки обновления каталога пройдены");
