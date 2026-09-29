import type { ReactNode } from "react";

type SourceKind = "1c" | "supplier";

const STYLES: Record<SourceKind, string> = {
  "1c": "border-slate-300 bg-slate-100 text-brand",
  supplier: "border-slate-200 bg-[#F3F4F6] text-mute",
};

const LABELS: Record<SourceKind, string> = {
  "1c": "1С",
  supplier: "Поставщик",
};

/** Спокойный бейдж происхождения: наша номенклатура 1С или товар поставщика. */
export function SourceBadge({ kind }: { kind: SourceKind }) {
  return (
    <span className={`mr-1.5 inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLES[kind]}`}>
      {LABELS[kind]}
    </span>
  );
}

export function SourcedName({ kind, children }: { kind: SourceKind; children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-0">
      <SourceBadge kind={kind} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}
