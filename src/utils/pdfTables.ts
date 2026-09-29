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

  return cells
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
}

export async function extractPdfMatrix(data: ArrayBuffer): Promise<{ matrix: string[][]; textual: boolean }> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const document = await pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const items: PlacedText[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim() || !("transform" in item)) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
    }
  }
  const matrix = matrixFromPlacedText(items);
  const filled = matrix.reduce((sum, row) => sum + row.filter((cell) => cell.trim()).length, 0);
  const textual = filled >= 4 && matrix.some((row) => row.filter((cell) => cell.trim()).length >= 2);
  return { matrix: textual ? matrix : [], textual };
}
