import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CatalogItem } from "../types";
import { searchCatalog } from "../utils/search";

interface CatalogPickerProps {
  catalog: CatalogItem[];
  top: number;
  left: number;
  onSelect: (item: CatalogItem) => void;
  onClose: () => void;
}

export function CatalogPicker({ catalog, top, left, onSelect, onClose }: CatalogPickerProps) {
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = searchCatalog(catalog, query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Выбор товара"
      className="fixed z-30 flex max-h-[420px] w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-card"
      style={{ top, left }}
    >
      <div className="border-b border-slate-100 p-3">
        <input
          ref={inputRef}
          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-base"
          placeholder="шуманит"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ul className="overflow-auto">
        {query.trim().length < 3 ? (
          <li className="px-3 py-3 text-sm text-mute">Введите минимум 3 символа</li>
        ) : results.length === 0 ? (
          <li className="px-3 py-3 text-sm text-mute">Ничего не найдено</li>
        ) : (
          results.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-canvas"
                onClick={() => onSelect(item)}
              >
                <div className="break-words text-sm">{item.name}</div>
                <div className="text-xs text-mute">
                  {item.code}
                  {item.unit ? ` · ${item.unit}` : ""}
                </div>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>,
    document.body,
  );
}
