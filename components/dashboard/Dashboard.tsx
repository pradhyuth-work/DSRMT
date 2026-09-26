"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ClipboardList,
  IndianRupee,
  Loader2,
  LogOut,
  Package,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Store,
  UserCog,
  Users,
  Wallet,
  Wallet2,
  type LucideIcon,
} from "lucide-react";
import type {
  AuthUser,
  OrderDTO,
  OutletDTO,
  ProductDTO,
  ReportsResponse,
  Role,
  StaffDTO,
  StockMovementDTO,
} from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api, setUnauthorizedHandler } from "./api-client";
import { clearToken, getToken, setToken } from "./session";
import { Alert, StatCard } from "./ui";
import LoginScreen from "./LoginScreen";
import SaleForm from "./SaleForm";
import OrdersView from "./OrdersView";
import OutletLedgers from "./OutletLedgers";
import PaymentsView from "./PaymentsView";
import StaffPerformanceView from "./StaffPerformance";
import InventoryManager from "./InventoryManager";
import UsersManager from "./UsersManager";

type TabId = "sale" | "orders" | "ledgers" | "payments" | "staff" | "inventory" | "users";

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

// Which tabs each role sees, in order. The server enforces the same rules on every route.
const TABS_BY_ROLE: Record<Role, TabDef[]> = {
  admin: [
    { id: "sale", label: "New Sale", icon: ShoppingCart },
    { id: "orders", label: "Orders", icon: ClipboardList },
    { id: "ledgers", label: "Outlet Ledgers", icon: Store },
    { id: "payments", label: "Payments", icon: Wallet2 },
    { id: "staff", label: "Staff Performance", icon: Users },
    { id: "inventory", label: "Stock", icon: Package },
    { id: "users", label: "Users", icon: UserCog },
  ],
  stock: [
    { id: "orders", label: "Orders to dispatch", icon: ClipboardList },
    { id: "payments", label: "Collect Payment", icon: Wallet2 },
    { id: "inventory", label: "Stock", icon: Package },
  ],
  agent: [
    { id: "sale", label: "New order", icon: ShoppingCart },
    { id: "orders", label: "My orders", icon: ClipboardList },
  ],
};

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", stock: "Stock incharge", agent: "Field agent" };

export interface DashboardData {
  products: ProductDTO[];
  /** Agents: only outlets assigned to them. Admin/stock: every outlet. */
  outlets: OutletDTO[];
  orders: OrderDTO[];
  /** Admin only. */
  staff: StaffDTO[];
  /** Admin only. */
  reports: ReportsResponse | null;
  /** Admin and stock only. */
  movements: StockMovementDTO[];
}

async function loadData(role: Role): Promise<DashboardData> {
  const isAdmin = role === "admin";
  const [products, outlets, orders, staff, reports, movements] = await Promise.all([
    api.products(),
    api.outlets(),
    api.orders(),
    isAdmin ? api.staff() : Promise.resolve([]),
    isAdmin ? api.reports() : Promise.resolve(null),
    role === "agent" ? Promise.resolve([]) : api.stockMovements(),
  ]);
  return { products, outlets, orders, staff, reports, movements };
}

export default function Dashboard() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<TabId>("sale");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const signOut = useCallback((message?: string) => {
    clearToken();
    setUser(null);
    setData(null);
    setError(null);
    setNotice(message ?? null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut("Your session has ended. Please sign in again."));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Restore a saved session on first load.
  useEffect(() => {
    if (!getToken()) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  const tabs = useMemo(() => (user ? TABS_BY_ROLE[user.role] : []), [user]);

  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [tabs, tab]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      setData(await loadData(user.role));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        notice={notice}
        onLogin={(token, u) => {
          setToken(token);
          setNotice(null);
          setTab(TABS_BY_ROLE[u.role][0].id);
          setUser(u);
        }}
      />
    );
  }

  const metrics = data?.reports?.dashboard;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-indigo-600 p-2 text-white">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight">DSRMT Billing</h1>
              <p className="truncate text-xs text-slate-500">
                {user.name} · {ROLE_LABEL[user.role]}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="btn btn-secondary px-3" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button className="btn btn-secondary px-3" onClick={() => signOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {user.role === "admin" && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total Billed" value={metrics ? formatMoney(metrics.totalBilled) : "—"} icon={IndianRupee} />
            <StatCard label="Total Collected" value={metrics ? formatMoney(metrics.totalCollected) : "—"} icon={Wallet} tone="emerald" />
            <StatCard label="Outstanding" value={metrics ? formatMoney(metrics.totalOutstanding) : "—"} icon={ReceiptText} tone="amber" />
            <StatCard label="Stock Units" value={metrics ? metrics.totalStockUnits.toLocaleString("en-IN") : "—"} icon={Boxes} tone="sky" />
          </section>
        )}

        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {tabs.map(({ id, label, icon: Icon }) => (
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
            {tab === "sale" && <SaleForm data={data} user={user} onSaved={refresh} />}
            {tab === "orders" && <OrdersView data={data} user={user} onSaved={refresh} />}
            {tab === "ledgers" && data.reports && (
              <OutletLedgers data={{ reports: data.reports, staff: data.staff, outlets: data.outlets }} onSaved={refresh} />
            )}
            {tab === "payments" && <PaymentsView user={user} outlets={data.outlets} staff={data.staff} />}
            {tab === "staff" && <StaffPerformanceView />}
            {tab === "inventory" && (
              <InventoryManager products={data.products} movements={data.movements} role={user.role} onSaved={refresh} />
            )}
            {tab === "users" && (
              <UsersManager
                staff={data.staff}
                user={user}
                onSaved={refresh}
                onOwnTokenChanged={(token) => setToken(token)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
