import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";

const root = "C:/Users/1/Desktop/Прайсы";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const skill = await server.ssrLoadModule("/src/utils/priceSkill.ts");
const failures = [];

function check(name, condition, details = "") {
  if (!condition) failures.push(`${name}${details ? `: ${details}` : ""}`);
}

function rowText(row) {
  if (!row) return "нет строки";
  return `name=${row[1]} price=${row[2]} barcode=${row[3]} code=${row[4]} unit=${row[5]} stock=${row[7]} pack=${row[8]} supplierCode=${row[10]}`;
}

function badName(name) {
  const value = String(name).trim().toLowerCase().replace(/ё/g, "е");
  return /^(бритье|влажные салфетки|гель для душа|основной склад|акция|бакалея|консервы|продукты питания|кофе, чай|подарочные наборы)$/.test(value)
    || value.startsWith("* ")
    || value.includes("подарочные наборы")
    || value === "новинка";
}

const files = readdirSync(root);
const summaries = [];
for (const name of files) {
  const bytes = readFileSync(join(root, name));
  const file = new File([bytes], name);
  let documents = [];
  try {
    documents = await skill.normalizePriceFile(file, "Поставщик", null);
  } catch (error) {
    failures.push(`${name}: ошибка чтения ${error instanceof Error ? error.message : error}`);
    continue;
  }
  for (const document of documents) {
    const label = document.fileName || name;
    const first = document.rows[0];
    summaries.push(`${label} | ${document.status} | строк ${document.rows.length} | ${document.reason || rowText(first)}`);
    check(`${label} прочитан`, document.status === "ready" || document.question, document.reason);
    if (document.status !== "ready") continue;
    check(`${label} есть товары`, document.rows.length > 5, String(document.rows.length));
    check(`${label} цены числа`, document.rows.every((row) => typeof row[2] === "number" && row[2] > 0));
    check(`${label} нет служебных имён`, document.rows.every((row) => !badName(row[1])), document.rows.find((row) => badName(row[1]))?.[1] ?? "");
    check(`${label} штрихкод не научный`, document.rows.every((row) => !/e\+/i.test(String(row[3]))));
    check(`${label} код не идентификатор`, document.rows.every((row) => row[4] === ""));
    check(`${label} нет пустого имени`, document.rows.every((row) => String(row[1]).trim()));
  }
}

function findDoc(part) {
  return summaries.find((line) => line.toLowerCase().includes(part.toLowerCase()));
}

async function one(name) {
  const file = new File([readFileSync(join(root, name))], name);
  const documents = await skill.normalizePriceFile(file, "Поставщик", null);
  return documents[0];
}

const bagi = await one("БАГИ от 3000 (1).xlsx");
check("БАГИ цена со скидкой", bagi.rows[0]?.[2] === 372.35, String(bagi.rows[0]?.[2]));
check("БАГИ не регулярная", bagi.rows.every((row) => row[2] !== 438.06));
check("БАГИ ведущий ноль", String(bagi.rows[0]?.[3]).startsWith("0729"), bagi.rows[0]?.[3]);
check("БАГИ имя", String(bagi.rows[0]?.[1]).includes("Bagi"));

const nanfu = await one("Прайс NANFU сентябрь 26.xls");
check("NANFU базовая промо", nanfu.rows[0]?.[2] === 125.36, String(nanfu.rows[0]?.[2]));
check("NANFU не порог", nanfu.rows.every((row) => row[2] !== 104.47 && row[2] !== 94.72));
check("NANFU штрихкод", nanfu.rows[0]?.[3] === "6901826018283", nanfu.rows[0]?.[3]);

const opt = await one("ОПТ 1 13092026.xls");
const bounty = opt.rows.find((row) => String(row[1]).includes("БАУНТИ"));
check("ОПТ баунти", bounty && bounty[2] === 200 && /упак/i.test(bounty[5]), rowText(bounty));
check("ОПТ без бакалеи", opt.rows.every((row) => !/^бакалея$/i.test(String(row[1]).trim())));

const pdf = await one("ОПТ 1 13092026.pdf");
check("PDF статус", pdf.status === "ready", pdf.reason);
check("PDF баунти", pdf.rows.some((row) => /баунти/i.test(row[1]) && row[2] === 200), pdf.rows.slice(0, 3).map(rowText).join(" || "));

const opt2 = await one("Опт2 (45).xls");
const fairy = opt2.rows.find((row) => /фейри|fairy/i.test(row[1]));
check("Опт2 феири", fairy && fairy[3] === "4015400869443" && fairy[2] === 242.88, rowText(fairy));
check("Опт2 заказ не остаток", opt2.rows.every((row) => row[7] !== "0"));

const spec = await one("Спец-предложение (41).xls");
const specItem = spec.rows.find((row) => String(row[1]).includes("Мартика"));
check("Спец цена", specItem && specItem[2] === 110, rowText(specItem));

const ai = await one("Прайс АИ-Трейд Безнал 18.09 (1).xls");
const chaika = ai.rows.find((row) => String(row[1]).includes("Чайка 15кг"));
check("АИ-Трейд чайка", chaika && chaika[2] === 1319.74, rowText(chaika));
check("АИ-Трейд без группы", ai.rows.every((row) => !String(row[1]).includes("СОНЦА")));

const gor = await one("ПРАЙС Горохов Н.В..xls");
const winter = gor.rows.find((row) => String(row[1]).includes("Winter Melody"));
check("Горохов товар", winter && winter[2] === 295.88 && winter[5] === "шт" && winter[3] === "6900108725420", rowText(winter));
check("Горохов без группы", gor.rows.every((row) => !String(row[1]).includes("ПОДАРОЧНЫЕ")));
check("Горохов код отдельно", winter && winter[4] === "" && winter[10].includes("УГ-"), winter?.[10]);

const kuban = await one("Прайс лист 23.09.2026.xls");
const coffee = kuban.rows.find((row) => String(row[1]).includes("LA SORA"));
check("Кубань кофе", coffee && coffee[2] === 306, rowText(coffee));
check("Кубань без раздела", kuban.rows.every((row) => String(row[1]).trim() !== "Продукты питания"));

const sca = await one("Промо SCA от 60 тыс. Краснодар.xls");
check("SCA цена акции", sca.rows[0]?.[2] === 145.44, String(sca.rows[0]?.[2]));
check("SCA не регулярная", sca.rows.every((row) => row[2] !== 276.56));
check("SCA штрихкод", sca.rows[0]?.[3] === "7322541979311");

const stupino = await one("Ступино крупный ОПТ_1.xlsx");
check("Ступино цена", stupino.rows[0]?.[2] === 233.49, String(stupino.rows[0]?.[2]));
const zero = stupino.rows.find((row) => String(row[1]).includes("Лаванда"));
check("Ступино ведущий ноль", String(zero?.[3]).startsWith("0460"), zero?.[3]);

const oldPrice = await one("16.09 Прайс АРНЕСТ.xls");
const libretta = oldPrice.rows.find((row) => String(row[1]).includes("LIBRETTA"));
check("16.09 имя и цена", libretta && libretta[2] === 87, rowText(libretta));
check("16.09 штрихкод не у всех, но есть", oldPrice.rows.some((row) => row[3] === "8690511195160"));
check("16.09 остаток", oldPrice.rows.some((row) => row[7] === "80" || row[7] === "48"));
check("16.09 упаковка", oldPrice.rows.some((row) => row[8] === "8" || row[8] === "12"));
check("16.09 без акции", oldPrice.rows.every((row) => !/^акция$/i.test(String(row[1]).trim())));

const stock = await one("102 АТЛАНТ.xls");
check("склад товар", stock.rows.some((row) => String(row[1]).includes("BIG METAL") && row[2] === 149.6));
check("склад без группы бритье", stock.rows.every((row) => String(row[1]).trim() !== "Бритье"));
check("склад остаток", stock.rows.some((row) => row[7] === "640"));

const zip = await skill.normalizePriceFile(new File([readFileSync(join(root, "19-09-2026_08-25-39.zip"))], "19-09-2026_08-25-39.zip"), "Поставщик", null);
check("zip два файла", zip.length === 2 && zip.every((item) => item.status === "ready" && item.rows.length > 100), zip.map((item) => `${item.fileName}:${item.status}:${item.rows.length}`).join(" | "));

const known = await one("Прайс NANFU сентябрь 26.xls");
const changed = await skill.ingestPriceSource(
  [{ name: "Лист", matrix: [["Название", "Стоимость"], ["Другой товар 500г", "10.50"]] }],
  "Поставщик",
  "new.xlsx",
  known.mapper,
);
check("смена структуры", changed.status === "ready" && changed.rows[0][1] === "Другой товар 500г" && changed.rows[0][2] === 10.5, changed.reason);

console.log(summaries.join("\n"));
console.log("---");
if (!findDoc("nanfu")) failures.push("сводка NANFU потеряна");
if (failures.length) {
  console.error(`FAILED ${failures.length}`);
  for (const failure of failures) console.error(failure);
  await server.close();
  process.exit(1);
}
console.log(`файлов ${files.length}, проверок без ошибок`);
await server.close();
