import type { ColumnMapper } from "../types";
import { columnChoicesOverlap, priceSample } from "../utils/mapping";
import { Button, Field, controlClass } from "./Button";
import { Hint } from "./Card";

interface MappingFormProps {
  fileName: string;
  supplier: string;
  matrix: string[][];
  headerRow: number;
  mapper: ColumnMapper;
  note: string | null;
  onHeaderRow: (value: number) => void;
  onMapper: (mapper: ColumnMapper) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const fields: Array<{ key: keyof Omit<ColumnMapper, "headerRow">; label: string; required?: boolean }> = [
  { key: "name", label: "Название товара", required: true },
  { key: "price", label: "Цена", required: true },
  { key: "barcode", label: "Штрихкод" },
  { key: "code", label: "Код товара" },
  { key: "unit", label: "Единица измерения" },
];

function columnLabel(header: string, index: number): string {
  return `${index + 1}. ${header.trim() || "пусто"}`;
}

export function MappingForm({
  fileName,
  supplier,
  matrix,
  headerRow,
  mapper,
  note,
  onHeaderRow,
  onMapper,
  onSubmit,
  onCancel,
}: MappingFormProps) {
  const headers = matrix[headerRow - 1] ?? [];
  const preview = matrix.slice(headerRow, headerRow + 8);
  const overlap = columnChoicesOverlap(mapper);
  const sample = priceSample(matrix, headerRow, mapper.price);
  const ready = mapper.name >= 0 && mapper.price >= 0 && !overlap;

  return (
    <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
      <div>
        <h3 className="font-semibold text-brand">Как читать этот прайс</h3>
        <Hint>
          Файл «{fileName}», поставщик «{supplier}». Сопоставление колонок сохранится для этого поставщика.
        </Hint>
        {note ? <p className="mt-2 text-sm text-warn">{note}</p> : null}
      </div>
      <Field label="Строка с заголовками">
        <input
          className={controlClass}
          type="number"
          min={1}
          max={matrix.length}
          value={headerRow}
          onChange={(event) => onHeaderRow(Number(event.target.value))}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.required ? `${field.label} *` : field.label}>
            <select
              className={controlClass}
              value={mapper[field.key]}
              onChange={(event) => onMapper({ ...mapper, [field.key]: Number(event.target.value) })}
            >
              {!field.required ? <option value={-1}>— не использовать —</option> : <option value={-1}>Выберите колонку</option>}
              {headers.map((header, index) => (
                <option key={`${header}-${index}`} value={index}>
                  {columnLabel(header, index)}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {overlap ? <p className="text-sm text-danger">Каждая колонка выбирается один раз.</p> : null}
      {mapper.price >= 0 && sample.total > 0 ? (
        <Hint>
          В колонке цены распознано {sample.ok} из {sample.total} в предпросмотре.
        </Hint>
      ) : null}
      <div className="overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-canvas text-left text-brand">
            <tr>
              {headers.map((header, index) => (
                <th key={`${header}-${index}`} className="whitespace-nowrap px-3 py-2 font-medium">
                  {columnLabel(header, index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-slate-100">
                {headers.map((_, columnIndex) => (
                  <td key={columnIndex} className="max-w-[240px] break-words px-3 py-2 align-top">
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onSubmit} disabled={!ready}>
          Загрузить так
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
