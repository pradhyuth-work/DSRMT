"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClockCheck,
  Boxes,
  ClipboardList,
  IndianRupee,
  Loader2,
  LogOut,
  Menu,
  Package,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  BarChart3,
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
  RouteDTO,
  StaffDTO,
  StockMovementDTO,
} from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api, setUnauthorizedHandler } from "./api-client";
import { clearToken, getToken, setToken } from "./session";
import { Alert, StatCard } from "./ui";
import { BrandMark } from "./BrandMark";
import LoginScreen from "./LoginScreen";
import SaleForm from "./SaleForm";
import AgentOrderForm from "./AgentOrderForm";
import OrdersView from "./OrdersView";
import OutletLedgers from "./OutletLedgers";
import PaymentsView from "./PaymentsView";
import StaffPerformanceView from "./StaffPerformance";
import InventoryManager from "./InventoryManager";
import InventoryInwarding from "./InventoryInwarding";
import UsersManager from "./UsersManager";
import SalesReports from "./SalesReports";

type TabId = "sale" | "orders" | "ledgers" | "credit" | "payments" | "staff" | "inventory" | "inwarding" | "users" | "reports";

interface TabDef {
  id: TabId;
  label: string;
  helper: string;
  icon: LucideIcon;
}

// Which tabs each role sees, in order. The server enforces the same rules on every route.
const TABS_BY_ROLE: Record<Role, TabDef[]> = {
  admin: [
    { id: "sale", label: "New Sale", helper: "Record a sale", icon: ShoppingCart },
    { id: "orders", label: "Orders", helper: "Dispatch queue", icon: ClipboardList },
    { id: "ledgers", label: "Outlet Ledgers", helper: "Collect dues", icon: Store },
    { id: "credit", label: "Outlets in Credit", helper: "Pending dues only", icon: ReceiptText },
    { id: "payments", label: "Payments", helper: "Collections", icon: Wallet2 },
    { id: "staff", label: "Staff Performance", helper: "Track the crew", icon: Users },
    { id: "reports", label: "Reports", helper: "Sales breakdowns", icon: BarChart3 },
    { id: "inventory", label: "Stock", helper: "Stock on hand", icon: Package },
    { id: "inwarding", label: "Inwarding", helper: "Record purchases", icon: PackagePlus },
    { id: "users", label: "Users", helper: "Accounts & roles", icon: UserCog },
  ],
  stock: [
    { id: "orders", label: "Orders to dispatch", helper: "Dispatch queue", icon: ClipboardList },
    { id: "payments", label: "Collect Payment", helper: "Collections", icon: Wallet2 },
    { id: "inventory", label: "Stock", helper: "Stock on hand", icon: Package },
  ],
  agent: [
    { id: "sale", label: "New order", helper: "Record a sale", icon: ShoppingCart },
    { id: "orders", label: "My orders", helper: "Track your orders", icon: ClipboardList },
  ],
};

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", stock: "Stock incharge", agent: "Field agent" };

export interface DashboardData {
  products: ProductDTO[];
  /** Agents: only outlets on their route. Admin/stock: every outlet. */
  outlets: OutletDTO[];
  orders: OrderDTO[];
  /** Admin only. */
  staff: StaffDTO[];
  /** Admin only. */
  routes: RouteDTO[];
  /** Admin only. */
  reports: ReportsResponse | null;
  /** Admin and stock only. */
  movements: StockMovementDTO[];
}

async function loadData(role: Role): Promise<DashboardData> {
  const isAdmin = role === "admin";
  const [products, outlets, orders, staff, routes, reports, movements] = await Promise.all([
    api.products(),
    api.outlets(),
    api.orders(),
    isAdmin ? api.staff() : Promise.resolve([]),
    isAdmin ? api.routes() : Promise.resolve([]),
    isAdmin ? api.reports() : Promise.resolve(null),
    role === "agent" ? Promise.resolve([]) : api.stockMovements(),
  ]);
  return { products, outlets, orders, staff, routes, reports, movements };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-sidebar-primary text-sidebar-primary-foreground">
        <BrandMark size={18} tone="dark" />
      </div>
      <div>
        <p className={`${compact ? "text-base" : "text-[17px]"} font-bold tracking-[-.03em]`}>Varasidhi Enterprises</p>
        {!compact && <p className="font-mono-app text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/45">MT &middot; billing &amp; dispatch</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<TabId>("sale");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

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
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
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
  const isAgent = user.role === "agent";
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="ops-app flex min-h-screen">
      {/* Desktop sidebar — admin/stock only. Agents are phone-first, so they never see it. */}
      {!isAgent && (
        <aside className="hidden md:flex w-[248px] shrink-0 flex-col bg-sidebar px-4 py-5 text-sidebar-foreground">
          <Brand />
          <div className="mt-10 flex-1">
            <p className="mb-3 px-3 font-mono-app text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/40">Workspace</p>
            <nav className="space-y-1">
              {tabs.map(({ id, label, helper, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`focus-ring group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${
                      active ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className={`block text-[10px] ${active ? "opacity-60" : "opacity-45"}`}>{helper}</span>
                    </span>
                    {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/70 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-sidebar-foreground/70">
              <span className="h-2 w-2 rounded-full bg-sidebar-primary" />
              Connected
            </div>
            <p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/50">Changes save straight to the live database.</p>
          </div>
          <div className="mt-5 flex items-center gap-3 px-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="text-[11px] text-sidebar-foreground/45">{ROLE_LABEL[user.role]}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="focus-ring shrink-0 rounded-lg p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>
      )}

      <main className="ops-grid min-w-0 flex-1">
        <div className="mx-auto max-w-[1536px] px-4 pb-8 sm:px-6 lg:px-10">
          <header className="flex h-[76px] items-center justify-between border-b border-foreground/10">
            {isAgent ? (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <BrandMark size={18} />
                </div>
                <h1 className="text-lg font-bold tracking-[-.03em]">Varasidhi Enterprises</h1>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 md:hidden">
                  <button
                    className="focus-ring rounded-lg p-2 hover:bg-foreground/5"
                    onClick={() => setMobileNav((v) => !v)}
                    aria-label="Open navigation"
                  >
                    <Menu size={20} />
                  </button>
                  <Brand compact />
                </div>
                <div className="hidden md:block">
                  <p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">{today}</p>
                  <h1 className="mt-1 text-xl font-bold tracking-[-.03em]">
                    Welcome, {user.name.split(/\s+/)[0]} <span className="text-muted-foreground">/</span>{" "}
                    <span className="text-muted-foreground">{ROLE_LABEL[user.role].toLowerCase()}</span>
                  </h1>
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <button
                className="focus-ring rounded-full p-2.5 text-muted-foreground transition hover:bg-foreground/5"
                onClick={() => void refresh()}
                disabled={refreshing}
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              </button>
              {isAgent && (
                <button
                  className="focus-ring rounded-full p-2.5 text-muted-foreground transition hover:bg-danger/20 hover:text-danger-foreground"
                  onClick={() => signOut()}
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut size={16} />
                </button>
              )}
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                {initials}
              </div>
            </div>
          </header>

          {!isAgent && mobileNav && (
            <div className="app-enter border-b border-foreground/10 py-3 md:hidden">
              <nav className="grid grid-cols-2 gap-2">
                {tabs.map(({ id, label, icon: Icon }) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setTab(id);
                        setMobileNav(false);
                      }}
                      className={`focus-ring flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${
                        active ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
                      }`}
                    >
                      <Icon size={18} />
                      <span className="text-sm font-semibold">{label}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => signOut()}
                  className="focus-ring flex items-center gap-3 rounded-xl bg-card px-3 py-3 text-left text-danger-foreground"
                >
                  <LogOut size={18} />
                  <span className="text-sm font-semibold">Sign out</span>
                </button>
              </nav>
            </div>
          )}

          {user.role === "admin" && (
            <section className="grid gap-3 py-6 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Total Billed" value={metrics ? formatMoney(metrics.totalBilled) : "—"} icon={IndianRupee} tone="lime" />
              <StatCard label="Total Collected" value={metrics ? formatMoney(metrics.totalCollected) : "—"} icon={Wallet} tone="gold" />
              <StatCard label="Outstanding" value={metrics ? formatMoney(metrics.totalOutstanding) : "—"} icon={ReceiptText} tone="rose" />
              <StatCard label="Stock Units" value={metrics ? metrics.totalStockUnits.toLocaleString("en-IN") : "—"} icon={Boxes} tone="teal" />
              <StatCard
                label="Outlets 30+ Days"
                value={metrics ? String(metrics.outletsOver30Days) : "—"}
                icon={AlarmClockCheck}
                tone="rose"
              />
            </section>
          )}

          {isAgent && (
            <div className="mt-5">
              <p className="text-2xl font-bold tracking-[-.03em]">Welcome, {user.name.split(/\s+/)[0]}</p>
              <p className="mt-1 text-sm text-muted-foreground">Your outlets, orders and today&apos;s dispatch queue</p>
              {/* Only two things an agent ever needs: big, unmissable, thumb-friendly. */}
              <nav className="mt-4 grid grid-cols-2 gap-3">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm font-semibold transition active:scale-[0.98] ${
                      tab === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          )}

          <div className={isAgent ? "app-enter mt-5" : "app-enter py-2"}>
            {error && (
              <div className="mb-4">
                <Alert kind="error">{error}</Alert>
              </div>
            )}

            {!data ? (
              !error && (
                <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              )
            ) : (
              <>
                {tab === "sale" &&
                  (isAgent ? (
                    <AgentOrderForm data={data} user={user} onSaved={refresh} />
                  ) : (
                    <SaleForm data={data} user={user} onSaved={refresh} />
                  ))}
                {tab === "orders" && <OrdersView data={data} user={user} onSaved={refresh} />}
                {tab === "ledgers" && data.reports && (
                  <OutletLedgers
                    data={{ reports: data.reports, staff: data.staff, outlets: data.outlets, routes: data.routes }}
                    user={user}
                    onSaved={refresh}
                  />
                )}
                {tab === "credit" && data.reports && (
                  <OutletLedgers
                    data={{ reports: data.reports, staff: data.staff, outlets: data.outlets, routes: data.routes }}
                    user={user}
                    onSaved={refresh}
                    onlyInCredit
                  />
                )}
                {tab === "payments" && <PaymentsView user={user} outlets={data.outlets} staff={data.staff} />}
                {tab === "staff" && <StaffPerformanceView />}
                {tab === "reports" && <SalesReports outlets={data.outlets} products={data.products} />}
                {tab === "inventory" && (
                  <InventoryManager products={data.products} movements={data.movements} role={user.role} onSaved={refresh} />
                )}
                {tab === "inwarding" && <InventoryInwarding products={data.products} movements={data.movements} onSaved={refresh} />}
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
          </div>
        </div>
      </main>
    </div>
  );
}
