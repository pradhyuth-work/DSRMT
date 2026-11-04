"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import type { AgentBalanceDTO, AgentIssueDTO } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, PAGE_SIZE, Pagination, formatDate, usePagination } from "./ui";
import { Combobox } from "./Combobox";
import type { DashboardData } from "./Dashboard";

interface Line {
  key: number;
  productId: string;
  quantity: string;
}

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, productId: "", quantity: "1" });

/**
 * Agent Issue: stock given to a field agent without billing any outlet. Admin or stock
 * incharge picks the agent and the products and saves — no second confirmation. Stock leaves
 * the warehouse straight away and the value (billing rate, tax already inside) is added to
 * what the agent owes. Targets aren't tracked here; whoever hands the stock over decides what
 * to give. Laid out like New Sale: items on the left, summary on the right.
 */
export default function AgentIssueView({ data, onSaved }: { data: DashboardData; onSaved: () => Promise<void> }) {
  const { products } = data;
  const [agents, setAgents] = useState<AgentBalanceDTO[] | null>(null);
  const [issues, setIssues] = useState<AgentIssueDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastIssue, setLastIssue] = useState<AgentIssueDTO | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([api.agentBalances(), api.agentIssues()]);
      setAgents(a);
      setIssues(i);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load agents");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAgents = useMemo(() => (agents ?? []).filter((a) => a.active), [agents]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Total requested per product across all lines, for the stock check.
  const requested = useMemo(() => {
    const totals = new Map<string, number>();
    for (const l of lines) {
      const q = Number.parseInt(l.quantity, 10);
      if (l.productId && q > 0) totals.set(l.productId, (totals.get(l.productId) ?? 0) + q);
    }
    return totals;
  }, [lines]);

  const computed = lines.map((l) => {
    const product = productById.get(l.productId);
    const qty = Number.parseInt(l.quantity, 10);
    const validQty = Number.isInteger(qty) && qty > 0;
    const subtotal = product && validQty ? round2(product.unitPrice * qty) : 0;
    const stockQty = product?.stockQty ?? 0;
    const insufficient = !!product && (requested.get(l.productId) ?? 0) > stockQty;
    return { line: l, product, qty, validQty, subtotal, insufficient, stockQty };
  });

  const total = round2(computed.reduce((s, c) => s + c.subtotal, 0));
  const hasShortage = computed.some((c) => c.insufficient);
  const hasIncompleteLine = computed.some((c) => !c.product || !c.validQty);
  const selectedAgent = activeAgents.find((a) => a.agentId === agentId);

  const blockers = [
    !agentId && "Select a field agent",
    hasIncompleteLine && "Complete every line item",
    hasShortage && "Resolve stock shortages",
  ].filter((b): b is string => Boolean(b));

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blockers.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const issue = await api.createAgentIssue({
        agentId,
        note: note.trim() || undefined,
        items: computed.map((c) => ({ productId: c.line.productId, quantity: c.qty })),
      });
      setLastIssue(issue);
      setLines([newLine()]);
      setNote("");
      await Promise.all([load(), onSaved()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the issue");
    } finally {
      setSubmitting(false);
    }
  }

  const page = usePagination(issues ?? []);

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {loadError && <Alert kind="error">{loadError}</Alert>}
          {agents && activeAgents.length === 0 && (
            <Alert kind="warning">There are no active field agents yet. Add one under Users first.</Alert>
          )}
          <div className="card p-5">
            <label className="label" htmlFor="issue-agent">Field agent</label>
            <Combobox
              id="issue-agent"
              value={agentId}
              onChange={setAgentId}
              disabled={activeAgents.length === 0}
              placeholder="Select field agent…"
              ariaLabel="Field agent"
              options={activeAgents.map((a) => ({
                value: a.agentId,
                label: a.agentName,
                description: a.balance > 0 ? `Owes ${formatMoney(a.balance)}` : "Owes nothing",
              }))}
            />
          </div>

          <div className="card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="font-semibold">Items</h2>
              <button type="button" className="btn btn-secondary py-1.5" onClick={() => setLines((p) => [...p, newLine()])}>
                <Plus className="h-4 w-4" /> Add item
              </button>
            </div>
            <div className="divide-y divide-border">
              {computed.map(({ line, product, subtotal, insufficient, stockQty }) => (
                <div key={line.key} className="grid grid-cols-12 items-start gap-3 px-5 py-4">
                  <div className="col-span-12 sm:col-span-6">
                    <Combobox
                      value={line.productId}
                      onChange={(v) => updateLine(line.key, { productId: v })}
                      placeholder="Select product…"
                      ariaLabel="Product"
                      options={products.map((p) => ({
                        value: p.id,
                        label: p.name,
                        disabled: !p.inStock,
                        description: `${formatMoney(p.unitPrice)} · ${p.stockQty ?? 0} in stock`,
                      }))}
                    />
                    {product && insufficient && (
                      <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger-foreground">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {stockQty === 0 ? "Out of stock" : `Only ${stockQty} in stock`}
                      </p>
                    )}
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={`input ${insufficient ? "border-danger-foreground focus:border-danger-foreground focus:ring-danger-foreground/30" : ""}`}
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="col-span-6 pt-2 text-right text-sm tabular-nums sm:col-span-3">
                    <span className="text-muted-foreground">{product ? `${formatMoney(product.unitPrice)} × ` : ""}</span>
                    <span className="font-semibold">{formatMoney(subtotal)}</span>
                  </div>
                  <div className="col-span-2 flex justify-end sm:col-span-1">
                    <button
                      type="button"
                      className="rounded-md p-2 text-muted-foreground hover:bg-danger hover:text-danger-foreground disabled:opacity-30"
                      onClick={() => setLines((p) => p.filter((l) => l.key !== line.key))}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-4 p-5 lg:sticky lg:top-6">
            <h2 className="font-semibold">Issue summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Items</dt>
                <dd className="tabular-nums">{computed.reduce((s, c) => s + (c.validQty && c.product ? c.qty : 0), 0)} units</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Added to balance</dt>
                <dd className="tabular-nums">{formatMoney(total)}</dd>
              </div>
            </dl>

            <p className="text-xs text-muted-foreground">
              No outlet is billed. Valued at the billing rate, tax included. Stock leaves the warehouse when you save.
            </p>

            <div>
              <label className="label" htmlFor="issue-note">Notes</label>
              <input
                id="issue-note"
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Optional, for example the month"
              />
            </div>

            {selectedAgent && selectedAgent.balance > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                <span className="text-muted-foreground">Owes now</span>
                <span className="font-semibold tabular-nums text-warning-foreground">{formatMoney(selectedAgent.balance)}</span>
              </div>
            )}

            {blockers.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {blockers.map((b) => <li key={b}>• {b}</li>)}
              </ul>
            )}
            {error && <Alert kind="error">{error}</Alert>}

            <button type="submit" className="btn btn-primary w-full" disabled={submitting || blockers.length > 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Issue to agent
            </button>
          </div>

          {lastIssue && (
            <Alert kind="success">
              <p className="font-semibold">
                {lastIssue.number} issued to {lastIssue.agentName} — {formatMoney(lastIssue.totalAmount)}
              </p>
              <p>Stock has been taken off the warehouse.</p>
            </Alert>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h2 className="font-semibold">Recent issues</h2>
        </div>
        {!issues ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : issues.length === 0 ? (
          <EmptyState>Nothing has been issued to an agent yet.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-secondary">
                  <tr>
                    <th className="th">Issue</th>
                    <th className="th">Date</th>
                    <th className="th">Agent</th>
                    <th className="th">Items</th>
                    <th className="th text-right">Value</th>
                    <th className="th">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {page.pageItems.map((i) => (
                    <tr key={i.id} className="hover:bg-secondary">
                      <td className="td font-medium tabular-nums">{i.number}</td>
                      <td className="td whitespace-nowrap">{formatDate(i.createdAt)}</td>
                      <td className="td">{i.agentName}</td>
                      <td className="td">
                        {i.items.map((it) => `${it.quantity} × ${it.productName}`).join(", ")}
                        {i.note && <span className="block text-xs text-muted-foreground">{i.note}</span>}
                      </td>
                      <td className="td text-right font-semibold tabular-nums">{formatMoney(i.totalAmount)}</td>
                      <td className="td">{i.createdByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
          </>
        )}
      </div>
    </div>
  );
}
