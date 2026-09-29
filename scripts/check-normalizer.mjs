import { createServer } from "vite";
import { zipSync } from "fflate";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const intake = await server.ssrLoadModule("/src/utils/priceIntake.ts");
const xlsx = await server.ssrLoadModule("/node_modules/xlsx/xlsx.mjs");

const failures = [];

function check(name, condition, details) {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
  else console.log(`ok ${name}`);
}

function sheet(rows) {
  return [{ name: "Прайс", matrix: rows }];
}

function rowOf(result, index = 0) {
  return result.rows[index];
}

const controlHeaders = [
  "Код товара",
  "Наименование товара",
  "ШК товара",
  "Торговая марка (ТМ)",
  "Товарная группа (ТГ)",
  "Товарная подгруппа (ТПГ)",
  "объём/вес",
  "логистический статус",
  "ставка НДС, %",
  "Цена клиента, руб.",
  "Кол-во штук на паллете",
  "Кол-во коробок на паллете",
];
const controlRows = [
  controlHeaders,
  ["100234", "Молоко Простоквашино 930мл", "4601234567890", "Простоквашино", "Молочные", "Молоко", "930 мл", "активный", "10", "89.50", "1200", "80"],
  ["100235", "Хлеб бородинский 400г", "4600000000001", "Коломенское", "Хлеб", "Бородинский", "400 г", "активный", "10", "45", "800", "40"],
  ["100236", "Сыр российский 200г", "4600000000002", "Простоквашино", "Молочные", "Сыр", "200 г", "вывод", "20", "210.00", "600", "30"],
];

function assertReady(name, result, sample) {
  check(name, result.status === "ready", result.reason || JSON.stringify(result.missing));
  if (result.status !== "ready") return;
  const row = rowOf(result);
  check(`${name}: имя`, row[1] === sample.name, row[1]);
  check(`${name}: цена`, row[2] === sample.price, String(row[2]));
  check(`${name}: штрихкод`, (row[3] || "") === (sample.barcode ?? ""), row[3]);
  check(`${name}: код не идентификатор`, row[4] === "");
  check(`${name}: остаток`, (row[7] || "") === (sample.stock ?? ""), row[7]);
  if (sample.supplierCode !== undefined) check(`${name}: код поставщика`, row[10] === sample.supplierCode, row[10]);
  if (sample.volume !== undefined) check(`${name}: объём`, row[11] === sample.volume, row[11]);
  check(`${name}: не марка`, !result.rows.some((item) => item[1] === "Простоквашино" || item[1] === "Молочные"));
  check(`${name}: не НДС`, result.rows.every((item) => item[2] !== 10 && item[2] !== 20));
  check(`${name}: не паллета`, result.rows.every((item) => item[7] !== "1200" && item[7] !== "800" && item[7] !== "80"));
}

const control = intake.ingestPriceSource(sheet(controlRows), "Контроль", "control.xlsx", null);
assertReady("контроль", control, {
  name: "Молоко Простоквашино 930мл",
  price: 89.5,
  barcode: "4601234567890",
  stock: "",
  supplierCode: "100234",
  volume: "930 мл",
});
check("контроль: поля", control.recognized.includes("Наименование") && control.recognized.includes("Цена") && control.recognized.includes("Штрихкод"));
check(
  "контроль: отброшено",
  ["Торговая марка (ТМ)", "Товарная группа (ТГ)", "ставка НДС, %", "Кол-во штук на паллете"].every((header) =>
    control.ignored.some((item) => item.includes(header.split(",")[0]) || item === header),
  ),
  control.ignored.join(" | "),
);

assertReady(
  "1 обычный xlsx",
  intake.ingestPriceSource(
    sheet([
      ["Наименование", "Цена", "Штрихкод", "Остаток", "Ед. изм."],
      ["Сахар песок 1кг", "70.00", "4600000000101", "12", "шт"],
      ["Соль экстра 500г", "25.50", "4600000000102", "4", "шт"],
    ]),
    "Альфа",
    "plain.xlsx",
    null,
  ),
  { name: "Сахар песок 1кг", price: 70, barcode: "4600000000101", stock: "12" },
);

assertReady(
  "2 таблица ниже",
  intake.ingestPriceSource(
    sheet([
      ["ООО Ромашка"],
      ["Прайс от 01.09.2026"],
      ["Телефон 8 800 000-00-00"],
      ["Условия: отсрочка 14 дней"],
      [],
      ["Наименование", "Цена", "Остаток"],
      ["Сахар песок 1кг", "70.00", "12"],
      ["Мука пшеничная 2кг", "92.40", "7"],
    ]),
    "Ромашка",
    "offset.xlsx",
    null,
  ),
  { name: "Сахар песок 1кг", price: 70, barcode: "", stock: "12" },
);

assertReady(
  "3 другие названия",
  intake.ingestPriceSource(
    sheet([
      ["Номенклатура", "Стоимость, руб", "Ед. изм."],
      ["Гречка 900г", "110", "шт"],
      ["Рис круглозерный 800г", "96.30", "шт"],
    ]),
    "Бета",
    "names.xlsx",
    null,
  ),
  { name: "Гречка 900г", price: 110, barcode: "", stock: "" },
);

assertReady(
  "4 код и штрихкод",
  intake.ingestPriceSource(
    sheet([
      ["Артикул", "Название", "EAN", "Прайс"],
      ["A-100", "Масло подсолнечное 1л", "4601111111111", "149.90"],
      ["A-101", "Масло оливковое 250мл", "4601111111112", "320.00"],
    ]),
    "Гамма",
    "both.xlsx",
    null,
  ),
  { name: "Масло подсолнечное 1л", price: 149.9, barcode: "4601111111111", supplierCode: "A-100", stock: "" },
);

assertReady(
  "5 без штрихкода",
  intake.ingestPriceSource(
    sheet([
      ["Товар", "Цена"],
      ["Чай черный 100г", "85.00"],
      ["Чай зеленый 100г", "90.00"],
    ]),
    "Дельта",
    "nobar.xlsx",
    null,
  ),
  { name: "Чай черный 100г", price: 85, barcode: "", stock: "" },
);

assertReady(
  "6 без остатка",
  intake.ingestPriceSource(
    sheet([
      ["Наименование", "Цена", "Штрихкод"],
      ["Кофе молотый 250г", "410.00", "4602222222221"],
      ["Кофе зерновой 1кг", "980.00", "4602222222222"],
    ]),
    "Дельта",
    "nostock.xlsx",
    null,
  ),
  { name: "Кофе молотый 250г", price: 410, barcode: "4602222222221", stock: "" },
);

assertReady(
  "7 НДС рядом с ценой",
  intake.ingestPriceSource(
    sheet([
      ["Наименование", "Ставка НДС %", "Цена клиента"],
      ["Вода питьевая 5л", "20", "75.00"],
      ["Вода газированная 1.5л", "20", "48.50"],
    ]),
    "НДС",
    "vat.xlsx",
    null,
  ),
  { name: "Вода питьевая 5л", price: 75, barcode: "", stock: "" },
);

assertReady(
  "8 паллета",
  intake.ingestPriceSource(
    sheet([
      ["Наименование", "Цена", "Остаток", "Кол-во штук на паллете", "Кол-во коробок на паллете"],
      ["Сок яблочный 1л", "89.00", "15", "1200", "80"],
      ["Сок томатный 1л", "92.00", "9", "1200", "80"],
    ]),
    "Паллета",
    "pallet.xlsx",
    null,
  ),
  { name: "Сок яблочный 1л", price: 89, barcode: "", stock: "15" },
);

assertReady(
  "9 марка группа подгруппа",
  intake.ingestPriceSource(
    sheet([
      ["Торговая марка", "Товарная группа", "Товарная подгруппа", "Наименование товара", "Цена"],
      ["Домик", "Молочные", "Кефир", "Кефир Домик 1% 900г", "64.00"],
      ["Домик", "Молочные", "Сметана", "Сметана Домик 15% 300г", "79.00"],
    ]),
    "Марка",
    "brand.xlsx",
    null,
  ),
  { name: "Кефир Домик 1% 900г", price: 64, barcode: "", stock: "" },
);

function fileFromRows(name, rows, bookType = "xlsx") {
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), "Прайс");
  const data = xlsx.write(book, { type: "array", bookType });
  return new File([data], name);
}

const plainFile = await intake.normalizePriceFile(
  fileFromRows("plain.xlsx", [
    ["Наименование", "Цена"],
    ["Сахар песок 1кг", "70.00"],
    ["Соль экстра 500г", "25.50"],
  ]),
  "Файл",
  null,
);
check("файл xlsx", plainFile[0].status === "ready" && plainFile[0].rows[0][2] === 70, plainFile[0].reason);

const xlsFile = await intake.normalizePriceFile(
  fileFromRows(
    "plain.xls",
    [
      ["Наименование", "Цена"],
      ["Сахар песок 1кг", "71.00"],
    ],
    "xls",
  ),
  "Файл",
  null,
);
check("файл xls", xlsFile[0].status === "ready" && xlsFile[0].rows[0][2] === 71, xlsFile[0].reason || xlsFile[0].unreadable);

const csv = new File(["Номенклатура;Стоимость\nГречка 900г;110,50\nРис 800г;96,00\n"], "price.csv");
const csvResult = await intake.normalizePriceFile(csv, "CSV", null);
check("10 csv", csvResult[0].status === "ready" && csvResult[0].rows[0][1] === "Гречка 900г" && csvResult[0].rows[0][2] === 110.5, csvResult[0].reason);

function buildPdf(lines) {
  const commands = ["BT", "/F1 11 Tf"];
  lines.forEach((cells, rowIndex) => {
    const y = 820 - rowIndex * 18;
    cells.forEach((text, column) => {
      const x = 40 + column * 140;
      commands.push(`1 0 0 1 ${x} ${y} Tm (${String(text).replace(/[()\\]/g, "")}) Tj`);
    });
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 900] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let cursor = "%PDF-1.4\n".length;
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(cursor);
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    parts.push(chunk);
    cursor += chunk.length;
  });
  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  parts.push(xref);
  return new TextEncoder().encode(parts.join(""));
}

const pdf = await intake.normalizePriceFile(
  new File([buildPdf([
    ["Name", "Price", "EAN"],
    ["Milk 1l", "89.50", "4600605033121"],
    ["Bread 400g", "45.00", "4600605033122"],
  ])], "price.pdf"),
  "PDF",
  null,
);
check("11 pdf", pdf[0].status === "ready" && pdf[0].rows[0][1] === "Milk 1l" && pdf[0].rows[0][2] === 89.5 && pdf[0].rows[0][3] === "4600605033121", `${pdf[0].reason} ${pdf[0].rows?.[0]?.join(" | ")}`);

const scan = await intake.normalizePriceFile(new File([buildPdf([["Scan"]])], "scan.pdf"), "PDF", null);
check("pdf скан", scan[0].status === "review" && scan[0].rows.length === 0 && /скан|изображен/i.test(scan[0].reason), scan[0].reason);

const known = intake.ingestPriceSource(
  sheet([
    ["Артикул", "Товар", "Цена", "Штрихкод"],
    ["A1", "Молоко 1л", "80.00", "4600000000001"],
  ]),
  "Известный",
  "old.xlsx",
  null,
);
const changed = intake.ingestPriceSource(
  sheet([
    ["Прайс", "Название позиции", "EAN", "Код"],
    ["90.00", "Кефир 500мл", "4600000000002", "B2"],
    ["120.00", "Ряженка 500мл", "4600000000003", "B3"],
  ]),
  "Известный",
  "new.xlsx",
  known.mapper,
);
assertReady("12 изменённый формат", changed, {
  name: "Кефир 500мл",
  price: 90,
  barcode: "4600000000002",
  supplierCode: "B2",
  stock: "",
});

const shifted = known.mapper
  ? intake.ingestPriceSource(
      sheet([
        ["Служебное", "Артикул", "Товар", "Цена", "Штрихкод"],
        ["x", "A1", "Молоко 1л", "80.00", "4600000000001"],
      ]),
      "Известный",
      "shifted.xlsx",
      { ...known.mapper, name: 0, price: 1, barcode: 2, code: 3 },
    )
  : null;
check(
  "сдвиг колонок",
  shifted?.status === "ready" && shifted.rows[0][1] === "Молоко 1л" && shifted.rows[0][2] === 80 && shifted.rows[0][3] === "4600000000001",
  shifted ? `${shifted.reason} ${shifted.rows[0]?.join(" | ")}` : "нет",
);

const zipBytes = zipSync({
  "one.csv": new TextEncoder().encode("Наименование,Цена\nСахар песок 1кг,70.00\n"),
  "two.csv": new TextEncoder().encode("Наименование,Цена\nСоль экстра 500г,25.00\n"),
});
const zipResult = await intake.normalizePriceFile(new File([zipBytes], "prices.zip"), "Архив", null);
check(
  "zip",
  zipResult.length === 2 && zipResult.every((item) => item.status === "ready") && zipResult.map((item) => item.rows[0][1]).sort().join("|") === "Сахар песок 1кг|Соль экстра 500г",
  zipResult.map((item) => `${item.fileName}:${item.status}:${item.reason}`).join("; "),
);

if (failures.length) {
  console.error(`\nFAILED ${failures.length}`);
  for (const failure of failures) console.error(failure);
  await server.close();
  process.exit(1);
}
console.log("\nвсе проверки пройдены");
await server.close();
