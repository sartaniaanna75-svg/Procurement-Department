import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet" | "filter" | "yes" | "alt" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-brand px-3 py-2 text-white hover:bg-[#1e446b] disabled:opacity-50",
  secondary: "bg-[#E5E7EB] px-3 py-2 text-ink hover:bg-[#D1D5DB] disabled:opacity-50",
  quiet: "bg-transparent px-1 py-1 text-brand underline underline-offset-2",
  filter: "px-3 py-2",
  yes: "bg-ok px-2 py-1 text-xs text-white hover:bg-[#14532d] disabled:opacity-40",
  alt: "bg-warn px-2 py-1 text-xs text-white hover:bg-[#92400e] disabled:opacity-40",
  ghost: "bg-[#F3F4F6] px-2 py-1 text-xs text-mute hover:bg-[#E5E7EB] disabled:opacity-40",
};

export function Button({ variant = "primary", active = false, className = "", type = "button", ...props }: ButtonProps) {
  const filterClass = active ? "bg-brand text-white hover:bg-[#1e446b]" : "bg-[#E5E7EB] text-ink hover:bg-[#D1D5DB]";
  const variantClass = variant === "filter" ? `${variants.filter} ${filterClass}` : variants[variant];
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed ${variantClass} ${className}`}
      {...props}
    />
  );
}

export function FilterBar<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button key={option.id} variant="filter" active={value === option.id} onClick={() => onChange(option.id)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

export const controlClass = "w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-base text-ink";
