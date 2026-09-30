import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Catalog1CTab } from "./components/Catalog1CTab";
import { Layout } from "./components/Layout";
import { MatchingTab } from "./components/MatchingTab";
import { OrderTab } from "./components/OrderTab";
import { PricesTab } from "./components/PricesTab";
import { SuppliersTab } from "./components/SuppliersTab";
import { TodayTab } from "./components/TodayTab";
import { AppStateProvider } from "./hooks/useAppState";
import { DemandStateProvider } from "./hooks/useDemandState";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <AppStateProvider>
        <DemandStateProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<TodayTab />} />
              <Route path="/suppliers" element={<SuppliersTab />} />
              <Route path="/prices" element={<PricesTab />} />
              <Route path="/matching" element={<MatchingTab />} />
              <Route path="/order" element={<OrderTab />} />
              <Route path="/nomenclature-1c" element={<Catalog1CTab />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </DemandStateProvider>
      </AppStateProvider>
    </BrowserRouter>
  );
}
