"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  IndianRupee,
  Loader2,
  Package,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { OutletDTO, ProductDTO, ReportsResponse, StaffDTO } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, StatCard } from "./ui";
import SaleForm from "./SaleForm";
import OutletLedgers from "./OutletLedgers";
import StaffPerformanceView from "./StaffPerformance";
import InventoryManager from "./InventoryManager";

type TabId = "sale" | "ledgers" | "staff" | "inventory";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "sale", label: "New Sale & Dispatch", icon: ShoppingCart },
  { id: "ledgers", label: "Outlet Ledgers", icon: Store },
  { id: "staff", label: "Staff Performance", icon: Users },
  { id: "inventory", label: "Inventory Manager", icon: Package },
];

export interface DashboardData {
  products: ProductDTO[];
  outlets: OutletDTO[];
  staff: StaffDTO[];
  reports: ReportsResponse;
}

export default function Dashboard() {
  const [tab, setTab] = useState<TabId>("sale");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [products, outlets, staff, reports] = await Promise.all([
        api.products(),
        api.outlets(),
        api.staff(),
        api.reports(),
      ]);
      setData({ products, outlets, staff, reports });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const metrics = data?.reports.dashboard;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-600 p-2 text-white">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">DSRMT Billing</h1>
              <p className="text-xs text-slate-500">Billing · Dispatch · Ledgers · Reconciliation</p>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total Billed" value={metrics ? formatMoney(metrics.totalBilled) : "—"} icon={IndianRupee} />
          <StatCard label="Total Collected" value={metrics ? formatMoney(metrics.totalCollected) : "—"} icon={Wallet} tone="emerald" />
          <StatCard label="Outstanding" value={metrics ? formatMoney(metrics.totalOutstanding) : "—"} icon={ReceiptText} tone="amber" />
          <StatCard label="Stock Units" value={metrics ? metrics.totalStockUnits.toLocaleString("en-IN") : "—"} icon={Boxes} tone="sky" />
        </section>

        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-1 sm:justify-center ${
                tab === id ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {error && <Alert kind="error">{error}</Alert>}

        {!data ? (
          !error && (
            <div className="flex items-center justify-center gap-2 py-20 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          )
        ) : (
          <>
            {tab === "sale" && <SaleForm data={data} onSaved={refresh} />}
            {tab === "ledgers" && <OutletLedgers data={data} onSaved={refresh} />}
            {tab === "staff" && <StaffPerformanceView rows={data.reports.staffPerformance} />}
            {tab === "inventory" && <InventoryManager products={data.products} onSaved={refresh} />}
          </>
        )}
      </main>
    </div>
  );
}
