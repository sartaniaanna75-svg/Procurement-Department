/**
 * CZ-09: проверка изоляции подразделений через IndexedDB (fake-indexeddb).
 * Запуск: node scripts/check-divisions.mjs
 */
import "./division-test-setup.mjs";
import { createServer } from "vite";

const failures = [];
function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

if (typeof indexedDB === "undefined") {
  console.error("indexedDB недоступен");
  process.exit(1);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const persist = await server.ssrLoadModule("/src/utils/persist.ts");
const storage = await server.ssrLoadModule("/src/utils/storage.ts");
const divisions = await server.ssrLoadModule("/src/utils/divisions.ts");
const suppliers = await server.ssrLoadModule("/src/utils/suppliers.ts");

const volo = divisions.DEFAULT_DIVISION;
const territory = "territory";

const voloCard = suppliers.createSupplier("Поставщик В", "v-sup");
const voloState = storage.normalizeState({
  ...storage.emptyState(),
  catalog: [{ code: "V1", name: "Товар Володарского", unit: "шт", barcode: "111" }],
  suppliers: [voloCard],
  uploads: [
    {
      file: "volo.xlsx",
      supplier: "Поставщик В",
      supplierId: voloCard.id,
      uploadedAt: "2026-01-01",
      cycleDate: "2026-01-01",
      versionId: "ver-v",
      rows: [{ name: "Товар", price: 10, barcode: "111", stock: 1, unit: "шт", pack: "", multiplicity: 1 }],
    },
  ],
  matches: { [`${voloCard.id}|Товар`]: { status: "confirmed", code: "V1", confidence: 1, reason: "test" } },
  confirmed: { V1: { supplier: "Поставщик В", price: 10, date: "2026-01-01" } },
  matchLogic: 10,
});

await persist.savePersistedState(voloState, volo);
await persist.saveDivisionConnections(volo, divisions.emptyDivisionConnections());
await persist.saveDivisionConnections(territory, divisions.emptyDivisionConnections());

const loadedVolo = await persist.loadDivisionState(volo);
check("volodarskogo keeps catalog", loadedVolo.catalog.length === 1 && loadedVolo.catalog[0].code === "V1");
check("volodarskogo keeps suppliers", loadedVolo.suppliers.length === 1);
check("volodarskogo keeps prices", loadedVolo.uploads.length === 1 && loadedVolo.uploads[0].file === "volo.xlsx");
check("volodarskogo keeps matches", Object.keys(loadedVolo.matches).length === 1);

const loadedTerritory = await persist.loadDivisionState(territory);
check("territory starts empty catalog", loadedTerritory.catalog.length === 0);
check("territory starts empty suppliers", loadedTerritory.suppliers.length === 0);
check("territory starts empty prices", loadedTerritory.uploads.length === 0);
check("territory starts empty matches", Object.keys(loadedTerritory.matches).length === 0);

const terrCard = suppliers.createSupplier("Поставщик Т", "t-sup");
const territoryState = storage.normalizeState({
  ...storage.emptyState(),
  suppliers: [terrCard],
  uploads: [
    {
      file: "territory.xlsx",
      supplier: "Поставщик Т",
      supplierId: terrCard.id,
      uploadedAt: "2026-02-01",
      cycleDate: "2026-02-01",
      versionId: "ver-t",
      rows: [{ name: "Другой", price: 5, barcode: "", stock: 0, unit: "шт", pack: "", multiplicity: 1 }],
    },
  ],
});

await persist.savePersistedState(territoryState, territory);

const afterVolo = await persist.loadDivisionState(volo);
const afterTerritory = await persist.loadDivisionState(territory);

check("territory supplier not in volodarskogo", afterVolo.suppliers.every((s) => s.id !== terrCard.id) && afterVolo.suppliers.length === 1);
check("volodarskogo supplier not in territory", afterTerritory.suppliers.every((s) => s.id !== voloCard.id) && afterTerritory.suppliers.length === 1);
check("territory price not in volodarskogo", afterVolo.uploads.every((u) => u.file !== "territory.xlsx"));
check("volodarskogo price not in territory", afterTerritory.uploads.every((u) => u.file !== "volo.xlsx"));
check("volodarskogo catalog not in territory", afterTerritory.catalog.length === 0);
check("volodarskogo matches not in territory", Object.keys(afterTerritory.matches).length === 0);
check("volodarskogo catalog intact after territory write", afterVolo.catalog.length === 1);

const voloConn = await persist.loadDivisionConnections(volo);
const terrConn = await persist.loadDivisionConnections(territory);
check("emailConnection stub volodarskogo", voloConn.emailConnection && voloConn.emailConnection.configured === false);
check("oneCConnection stub volodarskogo", voloConn.oneCConnection && voloConn.oneCConnection.configured === false);
check("emailConnection stub territory", terrConn.emailConnection && terrConn.emailConnection.configured === false);
check("oneCConnection stub territory", terrConn.oneCConnection && terrConn.oneCConnection.configured === false);

check("default division is volodarskogo", divisions.DEFAULT_DIVISION === "volodarskogo");

await server.close();

if (failures.length) {
  console.error("FAILED:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("\nAll CZ-09 division checks passed.");
