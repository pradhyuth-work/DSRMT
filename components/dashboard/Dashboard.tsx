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
  UserRound,
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
import AgentOrderForm from "./AgentOrderForm";
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
      <div className="flex min-h-screen items-center justify-center gap-2 text-slate-400">
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
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Soft ambient glow, purely decorative. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />

      <header className="relative border-b border-slate-800/80 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <ReceiptText className="h-5 w-5" />
            </div>
            <h1 className="truncate text-lg font-semibold leading-tight">DSRMT Billing</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="rounded-full border border-slate-800 bg-slate-900 p-2.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
              onClick={() => void refresh()}
              disabled={refreshing}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              className="rounded-full border border-slate-800 bg-slate-900 p-2.5 text-slate-500 transition hover:bg-red-500/15 hover:text-red-400"
              onClick={() => signOut()}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <div className="ml-1 flex items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900 py-1 pl-1 pr-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-semibold text-white">
                {initials || <UserRound className="h-4 w-4" />}
              </span>
              <span className="hidden min-w-0 leading-tight sm:block">
                <span className="block truncate text-sm font-medium text-slate-100">{user.name}</span>
                <span className="block text-xs text-slate-500">{ROLE_LABEL[user.role]}</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-50">Welcome, {user.name.split(/\s+/)[0]}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {user.role === "admin"
              ? "Here's your billing & dispatch overview"
              : user.role === "stock"
                ? "Orders waiting to dispatch and payments to collect"
                : "Your outlets, orders and today's dispatch queue"}
          </p>
        </div>

        {user.role === "admin" && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total Billed" value={metrics ? formatMoney(metrics.totalBilled) : "—"} icon={IndianRupee} />
            <StatCard label="Total Collected" value={metrics ? formatMoney(metrics.totalCollected) : "—"} icon={Wallet} tone="emerald" />
            <StatCard label="Outstanding" value={metrics ? formatMoney(metrics.totalOutstanding) : "—"} icon={ReceiptText} tone="amber" />
            <StatCard label="Stock Units" value={metrics ? metrics.totalStockUnits.toLocaleString("en-IN") : "—"} icon={Boxes} tone="sky" />
          </section>
        )}

        {user.role === "agent" ? (
          // Only two things an agent ever needs: big, unmissable, thumb-friendly.
          <nav className="grid grid-cols-2 gap-3">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm font-semibold transition active:scale-[0.98] ${
                  tab === id
                    ? "border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "border-slate-800 bg-slate-900 text-slate-400"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </nav>
        ) : (
          <nav className="flex gap-1 overflow-x-auto rounded-full border border-slate-800 bg-slate-900 p-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition sm:flex-1 sm:justify-center ${
                  tab === id ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        )}

        {error && <Alert kind="error">{error}</Alert>}

        {!data ? (
          !error && (
            <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          )
        ) : (
          <>
            {tab === "sale" &&
              (user.role === "agent" ? (
                <AgentOrderForm data={data} user={user} onSaved={refresh} />
              ) : (
                <SaleForm data={data} user={user} onSaved={refresh} />
              ))}
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
