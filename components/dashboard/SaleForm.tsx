"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Send, Trash2 } from "lucide-react";
import type { AuthUser, CreateSaleResponse, PaymentMethod } from "@/lib/types";
import { formatMoney, round2, statusFor } from "@/lib/money";
import { api } from "./api-client";
import { Alert, PaymentMethodPicker, StatusBadge } from "./ui";
import { Combobox } from "./Combobox";
import type { DashboardData } from "./Dashboard";

const LOW_STOCK_THRESHOLD = 10;

interface Line {
  key: number;
  productId: string;
  quantity: string;
}

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, productId: "", quantity: "1" });

export default function SaleForm({
  data,
  user,
  onSaved,
}: {
  data: DashboardData;
  user: AuthUser;
  onSaved: () => Promise<void>;
}) {
  const { products, staff } = data;
  // Hidden outlets stay fully visible in ledgers/reports — they just drop out of the
  // order-taking picker, same as the reference app's "hide a buyer" behaviour.
  const outlets = useMemo(() => data.outlets.filter((o) => !o.hidden), [data.outlets]);
  // Agents always own their orders; only admins pick the staff member.
  const choosesStaff = user.role === "admin";
  const [outletId, setOutletId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [paid, setPaid] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<CreateSaleResponse["invoice"] | null>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Picking an outlet fills in its route's agent automatically — admins can still override
  // it afterwards (e.g. an outlet with no route agent, or someone else took this order).
  function handleOutletChange(id: string) {
    setOutletId(id);
    if (!choosesStaff) return;
    const agentId = outlets.find((o) => o.id === id)?.agentId;
    if (agentId) setStaffId(agentId);
  }

  // Total requested per product across all lines, for stock checks.
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
    const totalRequested = requested.get(l.productId) ?? 0;
    // Agents only know whether an item is in stock, not the count.
    const stockQty = product?.stockQty;
    const insufficient = !!product && (stockQty === undefined ? !product.inStock : totalRequested > stockQty);
    const remaining = stockQty === undefined ? null : stockQty - totalRequested;
    return { line: l, product, qty, validQty, subtotal, insufficient, remaining };
  });

  const total = round2(computed.reduce((s, c) => s + c.subtotal, 0));
  const paidNum = Number.parseFloat(paid) || 0;
  const balance = round2(total - paidNum);
  const overpaid = paidNum > total;
  const hasShortage = computed.some((c) => c.insufficient);
  const hasIncompleteLine = computed.some((c) => !c.product || !c.validQty);

  const blockers = [
    !outletId && "Select an outlet",
    choosesStaff && !staffId && "Select a staff member",
    hasIncompleteLine && "Complete every line item",
    hasShortage && "Resolve stock shortages",
    overpaid && "Payment exceeds bill total",
    paidNum < 0 && "Payment cannot be negative",
  ].filter((b): b is string => Boolean(b));

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const reset = () => {
    setLines([newLine()]);
    setPaid("0");
    setNotes("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blockers.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const { invoice } = await api.createSale({
        outletId,
        staffId: choosesStaff ? staffId : undefined,
        items: computed.map((c) => ({ productId: c.line.productId, quantity: c.qty })),
        paidAmount: paidNum,
        paymentMethod,
        notes: notes.trim() || undefined,
      });
      setLastInvoice(invoice);
      reset();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {!choosesStaff && outlets.length === 0 && (
          <Alert kind="warning">You don&apos;t have any outlets assigned yet. Ask an admin to assign one to you.</Alert>
        )}
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="outlet">Outlet</label>
            <Combobox
              id="outlet"
              value={outletId}
              onChange={handleOutletChange}
              disabled={outlets.length === 0}
              placeholder="Select outlet…"
              ariaLabel="Outlet"
              options={outlets.map((o) => ({ value: o.id, label: o.name }))}
            />
          </div>
          {choosesStaff ? (
            <div>
              <label className="label" htmlFor="staff">Sales Staff</label>
              <Combobox
                id="staff"
                value={staffId}
                onChange={setStaffId}
                placeholder="Select staff…"
                ariaLabel="Sales Staff"
                options={staff.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
          ) : (
            <div>
              <span className="label">Order taken by</span>
              <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{user.name}</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="font-semibold">Items</h2>
            <button type="button" className="btn btn-secondary py-1.5" onClick={() => setLines((p) => [...p, newLine()])}>
              <Plus className="h-4 w-4" /> Add item
            </button>
          </div>
          <div className="divide-y divide-border">
            {computed.map(({ line, product, subtotal, insufficient, remaining }) => (
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
                      description: `${formatMoney(p.unitPrice)} · ${p.stockQty === undefined ? (p.inStock ? "in stock" : "out of stock") : `${p.stockQty} in stock`}`,
                    }))}
                  />
                  {product && insufficient && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger-foreground">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {remaining === null ? "Out of stock" : `Only ${product.stockQty} in stock — short by ${-remaining}`}
                    </p>
                  )}
                  {product && !insufficient && remaining !== null && remaining < LOW_STOCK_THRESHOLD && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-warning-foreground">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Low stock: {remaining} left after this sale
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
          <h2 className="font-semibold">Bill summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Items</dt>
              <dd className="tabular-nums">{computed.reduce((s, c) => s + (c.validQty && c.product ? c.qty : 0), 0)} units</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(total)}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <label className="label mb-0" htmlFor="paid">Paid now</label>
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setPaid(String(total))}>
                  Pay in full
                </button>
              </div>
              <input id="paid" type="number" min={0} step="0.01" className="input" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </div>
            <div className="col-span-2">
              <span className="label">Payment method</span>
              <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="notes">Notes</label>
              <input id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
            <span className="text-muted-foreground">Balance due</span>
            <span className="flex items-center gap-2">
              {total > 0 && !overpaid && <StatusBadge status={statusFor(total, paidNum)} />}
              <span className={`font-semibold tabular-nums ${balance > 0 ? "text-warning-foreground" : "text-success-foreground"}`}>
                {formatMoney(Math.max(balance, 0))}
              </span>
            </span>
          </div>

          {blockers.length > 0 && total > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {blockers.map((b) => <li key={b}>• {b}</li>)}
            </ul>
          )}
          {error && <Alert kind="error">{error}</Alert>}

          <button type="submit" className="btn btn-primary w-full" disabled={submitting || blockers.length > 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Create order
          </button>
        </div>

        {lastInvoice && (
          <Alert kind="success">
            <p className="font-semibold">
              Order created — {formatMoney(lastInvoice.totalAmount)} · awaiting billing
            </p>
            <p>
              Paid {formatMoney(lastInvoice.paidAmount)} · Balance {formatMoney(lastInvoice.balanceDue)} · {lastInvoice.status}
            </p>
          </Alert>
        )}
      </div>
    </form>
  );
}
