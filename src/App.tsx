import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { MatchingTab } from "./components/MatchingTab";
import { OrderTab } from "./components/OrderTab";
import { PricesTab } from "./components/PricesTab";
import { TodayTab } from "./components/TodayTab";
import { AppStateProvider } from "./hooks/useAppState";

export function App() {
  return (
    <BrowserRouter>
      <AppStateProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<TodayTab />} />
            <Route path="/prices" element={<PricesTab />} />
            <Route path="/matching" element={<MatchingTab />} />
            <Route path="/order" element={<OrderTab />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AppStateProvider>
    </BrowserRouter>
  );
}
