"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, Clock, IndianRupee, Loader2 } from "lucide-react";
import type { AgentBalanceDTO, AgentLedgerEntryDTO, AuthUser } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, DaysOutstandingBadge, EmptyState, PAGE_SIZE, Pagination, StatCard, formatDate, usePagination } from "./ui";
import { Combobox } from "./Combobox";

/**
 * What each field agent owes for stock issued to them. Admin and stock incharge pick an agent,
 * see the units in hand and the ledger, and record cash received (admin can also write off).
 * A field agent sees only their own account, read-only. Same chips / stat cards / tables as
 * Outlets in Credit.
 */
export default function AgentBalancesView({ user, onSaved }: { user: AuthUser; onSaved: () => Promise<void> }) {
  const isAgent = user.role === "agent";
  const [agents, setAgents] = useState<AgentBalanceDTO[] | null>(null);
  const [selectedId, setSelectedId] = useState(isAgent ? user.id : "");
  const [ledger, setLedger] = useState<AgentLedgerEntryDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [method, setMethod] = useState<"PAID" | "WRITE_OFF">("PAID");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents(await api.agentBalances());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load balances");
    }
  }, []);

  const loadLedger = useCallback(async (id: string) => {
    if (!id) return setLedger(null);
    try {
      setLedger(await api.agentLedger(id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the ledger");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setLedger(null);
    void loadLedger(selectedId);
  }, [selectedId, loadLedger]);

  const withBalance = useMemo(() => (agents ?? []).filter((a) => a.balance > 0 || a.unitsInHand > 0), [agents]);
  const selected = (agents ?? []).find((a) => a.agentId === selectedId) ?? null;
  const holding = selected?.holdings.find((h) => h.productId === productId) ?? null;

  const qty = Number.parseInt(quantity, 10);
  const validQty = Number.isInteger(qty) && qty > 0;
  const overHeld = !!holding && validQty && qty > holding.quantity;
  const previewAmount = holding && validQty && !overHeld ? round2((holding.value / holding.quantity) * qty) : null;

  const blockers = [
    !productId && "Select a product",
    productId && !validQty && "Enter a quantity",
    overHeld && `Agent holds only ${holding?.quantity}`,
    method === "WRITE_OFF" && reason.trim().length < 3 && "Give a reason for the write-off",
  ].filter((b): b is string => Boolean(b));

  async function settle(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || blockers.length) return;
    setSubmitting(true);
    setError(null);
    setDone(null);
    try {
      const res = await api.settleAgent(selected.agentId, {
        productId,
        quantity: qty,
        method,
        reason: method === "WRITE_OFF" ? reason.trim() : undefined,
      });
      setDone(`${method === "PAID" ? "Received" : "Written off"} ${formatMoney(res.amount)}. Balance is now ${formatMoney(res.balance)}.`);
      setProductId("");
      setQuantity("1");
      setReason("");
      await Promise.all([load(), loadLedger(selected.agentId), onSaved()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record");
    } finally {
      setSubmitting(false);
    }
  }

  const page = usePagination([...(ledger ?? [])].reverse());

  if (!agents) {
    return loadError ? (
      <Alert kind="error">{loadError}</Alert>
    ) : (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && <Alert kind="error">{loadError}</Alert>}

      {!isAgent && (
        <div className="space-y-2">
          <p className="label mb-0">Field agents</p>
          {withBalance.length === 0 ? (
            <div className="card">
              <EmptyState>No field agent owes anything for issued stock.</EmptyState>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {withBalance.map((a) => {
                const active = selectedId === a.agentId;
                return (
                  <button
                    key={a.agentId}
                    type="button"
                    onClick={() => setSelectedId(active ? "" : a.agentId)}
                    className={`card flex items-center gap-3 px-4 py-2.5 text-left transition hover:-translate-y-0.5 ${
                      active ? "border-primary ring-2 ring-primary/30" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{a.agentName}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {a.unitsInHand} unit{a.unitsInHand === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums text-warning-foreground">{formatMoney(a.balance)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="max-w-sm">
            <Combobox
              value={selectedId}
              onChange={setSelectedId}
              placeholder="Or search for an agent…"
              ariaLabel="Field agent"
              options={[{ value: "", label: "— None —" }, ...agents.map((a) => ({ value: a.agentId, label: a.agentName }))]}
            />
          </div>
        </div>
      )}

      {selected && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Owes" value={formatMoney(selected.balance)} icon={IndianRupee} tone="gold" />
            <StatCard label="Units in hand" value={String(selected.unitsInHand)} icon={Boxes} tone="teal" />
            <StatCard
              label="Oldest issue"
              value={selected.oldestDays === null ? "—" : `${selected.oldestDays} days`}
              icon={Clock}
              tone={selected.oldestDays !== null && selected.oldestDays > 30 ? "rose" : "lime"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card overflow-hidden lg:col-span-2">
              <div className="border-b border-border px-5 py-3">
                <h2 className="font-semibold">Holding now</h2>
              </div>
              {selected.holdings.length === 0 ? (
                <EmptyState>Nothing outstanding.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-secondary">
                      <tr>
                        <th className="th">Product</th>
                        <th className="th text-right">Units</th>
                        <th className="th text-right">Value</th>
                        <th className="th">Oldest</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selected.holdings.map((h) => (
                        <tr key={h.productId} className="hover:bg-secondary">
                          <td className="td font-medium">{h.productName}</td>
                          <td className="td text-right tabular-nums">{h.quantity}</td>
                          <td className="td text-right font-semibold tabular-nums">{formatMoney(h.value)}</td>
                          <td className="td"><DaysOutstandingBadge days={h.oldestDays} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {!isAgent && (
              <form onSubmit={settle} className="card space-y-4 p-5">
                <h2 className="font-semibold">Clear units</h2>
                <div>
                  <label className="label" htmlFor="settle-product">Product</label>
                  <Combobox
                    id="settle-product"
                    value={productId}
                    onChange={setProductId}
                    placeholder="Select product…"
                    ariaLabel="Product"
                    disabled={selected.holdings.length === 0}
                    options={selected.holdings.map((h) => ({
                      value: h.productId,
                      label: h.productName,
                      description: `${h.quantity} held · ${formatMoney(h.value)}`,
                    }))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="settle-qty">Quantity</label>
                  <input
                    id="settle-qty"
                    type="number"
                    min={1}
                    step={1}
                    className="input"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="settle-method">How</label>
                  <select
                    id="settle-method"
                    className="input"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as "PAID" | "WRITE_OFF")}
                  >
                    <option value="PAID">Paid in cash</option>
                    {user.role === "admin" && <option value="WRITE_OFF">Written off</option>}
                  </select>
                </div>
                {method === "WRITE_OFF" && (
                  <div>
                    <label className="label" htmlFor="settle-reason">Reason</label>
                    <input
                      id="settle-reason"
                      className="input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={200}
                      placeholder="Why is this being written off?"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{method === "PAID" ? "Cash to receive" : "Amount written off"}</span>
                  <span className="font-semibold tabular-nums">{previewAmount === null ? "—" : formatMoney(previewAmount)}</span>
                </div>
                {blockers.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {blockers.map((b) => <li key={b}>• {b}</li>)}
                  </ul>
                )}
                {error && <Alert kind="error">{error}</Alert>}
                {done && <Alert kind="success">{done}</Alert>}
                <button type="submit" className="btn btn-primary w-full" disabled={submitting || blockers.length > 0}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {method === "PAID" ? "Record payment" : "Write off"}
                </button>
              </form>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-semibold">Ledger</h2>
            </div>
            {!ledger ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : ledger.length === 0 ? (
              <EmptyState>No activity yet.</EmptyState>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-secondary">
                      <tr>
                        <th className="th">Date</th>
                        <th className="th">Entry</th>
                        <th className="th">Product</th>
                        <th className="th text-right">Units</th>
                        <th className="th text-right">Issued</th>
                        <th className="th text-right">Cleared</th>
                        <th className="th text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {page.pageItems.map((l) => (
                        <tr key={l.id} className="hover:bg-secondary">
                          <td className="td whitespace-nowrap">{formatDate(l.date)}</td>
                          <td className="td">
                            {l.type === "ISSUE" ? l.ref : l.type === "PAID" ? "Cash received" : "Written off"}
                            {l.note && <span className="block text-xs text-muted-foreground">{l.note}</span>}
                          </td>
                          <td className="td">{l.productName}</td>
                          <td className="td text-right tabular-nums">{l.quantity}</td>
                          <td className="td text-right tabular-nums">{l.debit ? formatMoney(l.debit) : ""}</td>
                          <td className="td text-right tabular-nums">{l.credit ? formatMoney(l.credit) : ""}</td>
                          <td className="td text-right font-semibold tabular-nums">{formatMoney(l.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
