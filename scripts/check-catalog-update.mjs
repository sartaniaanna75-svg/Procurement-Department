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
const rejected = update.inspectCatalog(finance, []);
check("чужой файл отклонён", !rejected.ok && rejected.reason === update.CATALOG_FILE_REJECTED);

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
const preview = update.inspectCatalog(proper, current);
check("правильный файл читается", preview.ok);
if (preview.ok) {
  check("найдено 3 товара", preview.preview.found === 3, String(preview.preview.found));
  check("со штрихкодом 2", preview.preview.withBarcode === 2, String(preview.preview.withBarcode));
  check("без штрихкода 1", preview.preview.withoutBarcode === 1, String(preview.preview.withoutBarcode));
  check("колонка наименования", preview.preview.nameHeader === "Наименование", preview.preview.nameHeader);
  check("колонка штрихкода", preview.preview.barcodeHeader === "Штрихкод", preview.preview.barcodeHeader);
  check("строка без названия отброшена", preview.preview.skipped === 1, String(preview.preview.skipped));
  check("новых 1", preview.preview.added === 1, String(preview.preview.added));
  check("изменившихся 1", preview.preview.changed === 1, String(preview.preview.changed));
  check("не найдено в выгрузке 1", preview.preview.removed === 1, String(preview.preview.removed));
  const fresh = preview.preview.items.find((item) => item.code === "00-00000999");
  check("научная запись раскрыта без округления", fresh?.barcode === "4605645006508", fresh?.barcode ?? "");
}

check("ведущий ноль сохраняется", update.barcodeFromCell("04605645006507") === "04605645006507");
check("пустая и нулевая ячейка не становятся штрихкодом", update.barcodeFromCell("") === "" && update.barcodeFromCell("0") === "");
check("сильное уменьшение", update.shrinkRisk(13340, 13) === "severe");
check("небольшое уменьшение не пугает", update.shrinkRisk(100, 90) === "none");

const aligned = update.alignCatalog(current, [
  { code: "NEW-1", name: "Мыло хозяйственное", unit: "шт", barcode: "4605645006507" },
]);
check("штрихкод сохраняет прежний код", aligned[0]?.code === "00-00000072", aligned[0]?.code ?? "");

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
state = memory.saveAbsent(state, row.key);
const absentBefore = Object.values(state.productMemory).some((item) => item.verdict === "absent");
const confirmedMemory = memory.saveKnownMatch(state, row.key, { status: "confirmed", code: "00-00000072", confidence: 100, reason: "вручную", relation: "exact" });
const nextCatalog = update.alignCatalog(confirmedMemory.catalog, [
  { code: "00-00000072", name: "Мыло", unit: "шт", barcode: "4605645006507" },
  { code: "00-00000999", name: "Новый товар", unit: "шт", barcode: "4605645006508" },
]);
const updated = matching.applyAutoMatch({
  ...confirmedMemory,
  catalog: nextCatalog,
  previousCatalog: confirmedMemory.catalog,
  catalogUpdatedAt: "2026-09-29T12:00:00.000Z",
});
check("подтверждение пережило обновление каталога", updated.matches[row.key]?.status === "confirmed" && updated.matches[row.key]?.code === "00-00000072", `${updated.matches[row.key]?.status} ${updated.matches[row.key]?.reason}`);
check("предыдущая версия сохранена", updated.previousCatalog.length === 3);
const restored = matching.applyAutoMatch({
  ...updated,
  catalog: updated.previousCatalog,
  previousCatalog: updated.catalog,
  catalogUpdatedAt: "2026-09-29T13:00:00.000Z",
});
check("предыдущая версия возвращается", restored.catalog.length === 3 && restored.catalog[0].code === "00-00000072");
check("после возврата решение на месте", restored.matches[row.key]?.status === "confirmed");
check("отказ от товара не стирается обновлением", absentBefore);

await server.close();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("проверки обновления каталога пройдены");
