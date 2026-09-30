import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAppState } from "../hooks/useAppState";
import { DIVISIONS } from "../utils/divisions";

const tabs = [
  { to: "/", label: "Сегодня", end: true },
  { to: "/suppliers", label: "Поставщики", end: false },
  { to: "/prices", label: "Прайсы", end: false },
  { to: "/matching", label: "Сопоставление", end: false },
  { to: "/order", label: "Заказ", end: false },
  { to: "/nomenclature-1c", label: "Номенклатура 1С", end: false },
];

export function Layout({ children }: { children: ReactNode }) {
  const { saveError, activeDivision, activeDivisionLabel, setActiveDivision, analyzing } = useAppState();

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="sticky top-0 flex h-screen w-[180px] shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4">
        <div className="mb-5 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">Центр закупок</div>
        <nav className="flex flex-col gap-1">
          {DIVISIONS.map((division) => {
            const active = division.id === activeDivision;
            return (
              <button
                key={division.id}
                type="button"
                disabled={analyzing}
                onClick={() => setActiveDivision(division.id)}
                className={`rounded-md border px-2 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-[#C9DFD2] bg-[#F3F8F5] font-semibold text-[#1F5C40]"
                    : "border-transparent font-medium text-mute hover:bg-slate-50 hover:text-ink"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#5BA882]" : "bg-transparent"}`} aria-hidden />
                  {division.label}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 bg-white">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-wide text-brand">ЗАКАЗЫ ПОСТАВЩИКАМ</h1>
              <p className="mt-0.5 text-xs text-mute">
                Подразделение: <span className="font-medium text-ink">{activeDivisionLabel}</span>
              </p>
            </div>
            <nav className="flex flex-wrap gap-1">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) => `nav-tab ${isActive ? "nav-tab-active" : ""}`}
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        {saveError ? <div className="border-b border-[#F0D5D5] bg-[#FDF4F4] px-4 py-2 text-center text-sm text-danger">{saveError}</div> : null}
        <main className="mx-auto max-w-[1280px] bg-white px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
