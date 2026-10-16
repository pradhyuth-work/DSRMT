"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HandCoins, Loader2, Search } from "lucide-react";
import type { AuthUser, OutletCreditDTO } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, DaysOutstandingBadge, EmptyState, Modal, PAGE_SIZE, Pagination, usePagination } from "./ui";
import { Combobox } from "./Combobox";
import { CollectPaymentForm } from "./payment-form";

const UNASSIGNED = "__unassigned__";

/**
 * "Who owes money", built on /api/outlets/credit instead of the admin-only /api/reports, so
 * it never carries company-wide totals or staff performance. No edit/hide/delete/manage-routes
 * here either — those stay admin-only in Outlet Ledgers.
 * - Stock incharge: every outlet in credit, can filter by field agent, and can collect a
 *   payment (which they can already do from the Payments tab too).
 * - Field agent: view-only, scoped server-side to their own outlets — no collect action,
 *   no agent filter (there's only ever one agent's worth of rows to look at).
 */
export default function OutletsInCreditView({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<OutletCreditDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [collecting, setCollecting] = useState<OutletCreditDTO | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const canCollect = user.role !== "agent";

  const load = useCallback(async () => {
    try {
      setRows(await api.outletsInCredit());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outlets in credit");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const agentOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows ?? []) {
      if (r.agentId) byId.set(r.agentId, r.agentName ?? r.agentId);
    }
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Per-agent outstanding totals — stock only, same "no point for an agent who only ever
  // sees their own outlets" reasoning as hiding the filter above.
  const agentTotals = useMemo(() => {
    if (!canCollect) return [];
    const byAgent = new Map<string, { id: string; name: string; balance: number; outlets: number }>();
    for (const r of rows ?? []) {
      const key = r.agentId ?? UNASSIGNED;
      const row = byAgent.get(key) ?? { id: key, name: r.agentId ? (r.agentName ?? r.agentId) : "Unassigned", balance: 0, outlets: 0 };
      row.balance = round2(row.balance + r.balance);
      row.outlets += 1;
      byAgent.set(key, row);
    }
    return [...byAgent.values()].sort((a, b) => b.balance - a.balance);
  }, [rows, canCollect]);

  const q = search.trim().toLowerCase();
  const filtered = (rows ?? []).filter((r) => {
    if (q && !r.outletName.toLowerCase().includes(q) && !r.phone.includes(q)) return false;
    if (agentFilter === UNASSIGNED) return !r.agentId;
    if (agentFilter) return r.agentId === agentFilter;
    return true;
  });
  const page = usePagination(filtered);

  return (
    <div className="space-y-4">
      {flash && <Alert kind="success">{flash}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input pl-9"
            placeholder="Search outlets by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canCollect && agentOptions.length > 0 && (
          <Combobox
            className="w-44"
            value={agentFilter}
            onChange={setAgentFilter}
            ariaLabel="Filter by field agent"
            placeholder="All field agents"
            options={[{ value: "", label: "All field agents" }, { value: UNASSIGNED, label: "Unassigned" }, ...agentOptions]}
          />
        )}
      </div>

      {agentTotals.length > 0 && (
        <div className="space-y-2">
          <p className="label mb-0">Outstanding by field agent</p>
          <div className="flex flex-wrap gap-2">
            {agentTotals.map((a) => {
              const active = agentFilter === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAgentFilter(active ? "" : a.id)}
                  className={`card flex items-center gap-3 px-4 py-2.5 text-left transition hover:-translate-y-0.5 ${
                    active ? "border-primary ring-2 ring-primary/30" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{a.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {a.outlets} outlet{a.outlets === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-warning-foreground">{formatMoney(a.balance)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {!rows ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="th">Outlet</th>
                  <th className="th">Route</th>
                  <th className="th text-right">Balance</th>
                  <th className="th text-right">Days of Credit</th>
                  {canCollect && <th className="th text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.pageItems.map((r) => (
                  <tr key={r.outletId} className="hover:bg-secondary">
                    <td className="td">
                      <p className="font-medium">{r.outletName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.phone} · {r.openInvoices.length} open invoice{r.openInvoices.length === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="td text-muted-foreground">{r.routeName ?? "—"}</td>
                    <td className="td text-right font-semibold tabular-nums text-warning-foreground">{formatMoney(r.balance)}</td>
                    <td className="td text-right">
                      {r.oldestInvoiceDays !== null ? <DaysOutstandingBadge days={r.oldestInvoiceDays} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    {canCollect && (
                      <td className="td text-right">
                        <button
                          className="btn btn-primary px-3 py-1.5"
                          onClick={() => {
                            setFlash(null);
                            setCollecting(r);
                          }}
                        >
                          <HandCoins className="h-4 w-4" />
                          <span className="hidden md:inline">Collect Payment</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && filtered.length === 0 && (
          <EmptyState>{rows.length === 0 ? "No outlets currently have an outstanding balance." : "No outlets match your search."}</EmptyState>
        )}
        <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
      </div>

      <Modal open={!!collecting} title={`Collect payment — ${collecting?.outletName ?? ""}`} onClose={() => setCollecting(null)}>
        {collecting && (
          <CollectPaymentForm
            key={collecting.outletId}
            target={{ outletId: collecting.outletId, outletName: collecting.outletName, balance: collecting.balance, openInvoices: collecting.openInvoices }}
            user={user}
            onDone={async (message) => {
              setCollecting(null);
              setFlash(message);
              await load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
