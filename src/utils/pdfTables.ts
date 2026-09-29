export interface PlacedText {
  str: string;
  x: number;
  y: number;
}

/**
 * Собирает текстовые фрагменты PDF в таблицу по координатам.
 * Если текста нет или это не таблица, возвращает пустую матрицу.
 */
export function matrixFromPlacedText(items: PlacedText[]): string[][] {
  const usable = items
    .map((item) => ({ str: item.str.replace(/\s+/g, " ").trim(), x: item.x, y: item.y }))
    .filter((item) => item.str);
  if (usable.length === 0) return [];

  const lines: PlacedText[][] = [];
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const line = lines.find((group) => Math.abs(group[0].y - item.y) <= 2.5);
    if (line) line.push(item);
    else lines.push([item]);
  }

  const cells = lines.map((line) => {
    const tokens = [...line].sort((a, b) => a.x - b.x);
    const grouped: { text: string; x: number }[] = [];
    for (const token of tokens) {
      const last = grouped[grouped.length - 1];
      if (last && token.x - (last.x + last.text.length * 4) < 14 && token.x - last.x < 36) {
        last.text = `${last.text} ${token.str}`.trim();
      } else {
        grouped.push({ text: token.str, x: token.x });
      }
    }
    return grouped;
  });

  const anchors: number[] = [];
  for (const row of cells) {
    for (const cell of row) {
      if (!anchors.some((anchor) => Math.abs(anchor - cell.x) <= 18)) anchors.push(cell.x);
    }
  }
  anchors.sort((a, b) => a - b);
  if (anchors.length < 2) return [];

  const matrix = cells
    .map((row) => {
      const values = Array.from({ length: anchors.length }, () => "");
      for (const cell of row) {
        let column = 0;
        let best = Number.POSITIVE_INFINITY;
        anchors.forEach((anchor, index) => {
          const distance = Math.abs(cell.x - anchor);
          if (distance < best) {
            best = distance;
            column = index;
          }
        });
        values[column] = values[column] ? `${values[column]} ${cell.text}` : cell.text;
      }
      return values;
    })
    .filter((row) => row.some((cell) => cell.trim()));
  return joinWrappedLines(collapseExclusiveTextColumns(matrix));
}

function looksLikeMoney(value: string): boolean {
  const text = value.trim();
  if (!text || !/\d/.test(text)) return false;
  if (/руб|₽/i.test(text)) return true;
  return /^\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{2})$/.test(text);
}

function longText(value: string): boolean {
  const text = value.trim();
  return text.length > 8 && !looksLikeMoney(text) && !/^\d+$/.test(text);
}

/** Соседние текстовые колонки, которые почти никогда не заполнены вместе, — это один столбец с отступом. */
function shouldMergeColumns(matrix: string[][], left: number, right: number): boolean {
  let both = 0;
  let either = 0;
  let money = 0;
  let text = 0;
  for (const row of matrix) {
    const a = (row[left] ?? "").trim();
    const b = (row[right] ?? "").trim();
    if (!a && !b) continue;
    either += 1;
    if (a && b) both += 1;
    if (looksLikeMoney(a) || looksLikeMoney(b)) money += 1;
    if (longText(a) || longText(b)) text += 1;
  }
  if (either < 4) return false;
  if (both / either > 0.15) return false;
  if (money / either > 0.25) return false;
  return text / either >= 0.45;
}

function collapseExclusiveTextColumns(matrix: string[][]): string[][] {
  let current = matrix.map((row) => [...row]);
  for (let guard = 0; guard < 6; guard += 1) {
    const width = current.reduce((max, row) => Math.max(max, row.length), 0);
    let merged = false;
    for (let column = 0; column < width - 1; column += 1) {
      if (!shouldMergeColumns(current, column, column + 1)) continue;
      current = current.map((row) => {
        const next = [...row];
        while (next.length < width) next.push("");
        const a = (next[column] ?? "").trim();
        const b = (next[column + 1] ?? "").trim();
        next[column] = a && b ? `${a} ${b}` : a || b;
        next.splice(column + 1, 1);
        return next;
      });
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return current;
}

function continuationFragment(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 48 || looksLikeMoney(text)) return false;
  return /\d/.test(text) || text.startsWith("(");
}

/** Хвост перенесённой строки PDF дописывается к предыдущему товару, а не становится отдельной позицией. */
function joinWrappedLines(matrix: string[][]): string[][] {
  const result: string[][] = [];
  for (const row of matrix) {
    const filled = row.map((cell, index) => ({ cell: cell.trim(), index })).filter((item) => item.cell);
    const previous = result[result.length - 1];
    const previousHasMoney = previous?.some((cell) => looksLikeMoney(cell)) ?? false;
    if (filled.length === 1 && continuationFragment(filled[0].cell) && previous && previousHasMoney) {
      let nameColumn = 0;
      let best = 0;
      previous.forEach((cell, index) => {
        if (!looksLikeMoney(cell) && cell.trim().length > best) {
          best = cell.trim().length;
          nameColumn = index;
        }
      });
      if (best > 8) {
        previous[nameColumn] = `${previous[nameColumn]} ${filled[0].cell}`.replace(/\s+/g, " ").trim();
        continue;
      }
    }
    result.push([...row]);
  }
  return result.filter((row) => row.some((cell) => cell.trim()));
}

async function openPdf(data: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
}

export async function extractPdfPages(data: ArrayBuffer): Promise<string[][][]> {
  const document = await openPdf(data);
  const pages: string[][][] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PlacedText[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim() || !("transform" in item)) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
    }
    const matrix = matrixFromPlacedText(items);
    if (matrix.length > 0) pages.push(matrix);
  }
  return pages;
}
