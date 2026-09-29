import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAppState } from "../hooks/useAppState";

const tabs = [
  { to: "/", label: "Сегодня", end: true },
  { to: "/prices", label: "Прайсы", end: false },
  { to: "/matching", label: "Номенклатура", end: false },
  { to: "/order", label: "Заказ", end: false },
];

export function Layout({ children }: { children: ReactNode }) {
  const { saveError } = useAppState();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold tracking-wide text-brand">ЗАКАЗЫ ПОСТАВЩИКАМ</h1>
          <nav className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `border-b-2 px-3 py-2 text-sm font-medium ${
                    isActive ? "border-brand text-brand" : "border-transparent text-mute hover:text-ink"
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {saveError ? <div className="bg-red-50 px-4 py-2 text-center text-sm text-danger">{saveError}</div> : null}
      <main className="mx-auto max-w-[1280px] px-4 py-6">{children}</main>
    </div>
  );
}
