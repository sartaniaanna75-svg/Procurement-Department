import type { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[10px] bg-white p-4 shadow-card">
      <h2 className="mb-3 text-lg font-semibold text-brand">{title}</h2>
      {children}
    </section>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-mute">{children}</p>;
}
