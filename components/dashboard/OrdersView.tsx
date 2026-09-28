"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Ban, Download, FileCheck, Loader2, Minus, Pencil, Plus, Trash2, Truck } from "lucide-react";
import type { AuthUser, FulfilmentStatus, OrderDTO } from "@/lib/types";
import { formatMoney, round2, splitBasicAndGst } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, FulfilmentBadge, Modal, StatusBadge, formatDate } from "./ui";
import { Combobox } from "./Combobox";
import type { DashboardData } from "./Dashboard";

type Filter = FulfilmentStatus | "ALL";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "PENDING", label: "Pending" },
  { id: "BILLED", label: "Billed" },
  { id: "DISPATCHED", label: "Dispatched" },
  { id: "CANCELLED", label: "Cancelled" },
  { id: "ALL", label: "All" },
];

/** The order's bill number for messages and headings — orders aren't given one until billed. */
const orderLabel = (o: OrderDTO) => (o.invoiceNumber ? `Bill #${o.invoiceNumber}` : "This order");

export default function OrdersView({
  data,
  user,
  onSaved,
}: {
  data: DashboardData;
  user: AuthUser;
  onSaved: () => Promise<void>;
}) {
  // Stock incharge works the pending queue; everyone else starts with the full list.
  const [filter, setFilter] = useState<Filter>(user.role === "stock" ? "PENDING" : "ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<OrderDTO | null>(null);
  const [billing, setBilling] = useState<OrderDTO | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState<OrderDTO | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);

  const orders = useMemo(() => {
    const list = filter === "ALL" ? data.orders : data.orders.filter((o) => o.fulfilmentStatus === filter);
    // Oldest first for the pending/billed queues so the longest-waiting order is on top.
    return filter === "PENDING" || filter === "BILLED" ? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : list;
  }, [data.orders, filter]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: data.orders.length, PENDING: 0, BILLED: 0, DISPATCHED: 0, CANCELLED: 0 };
    for (const o of data.orders) c[o.fulfilmentStatus]++;
    return c;
  }, [data.orders]);

  // Billing and dispatch are done by the same office/warehouse staff, in that order.
  const canBill = user.role === "admin" || user.role === "stock";
  const canDispatch = user.role === "admin" || user.role === "stock";

  const outletById = useMemo(() => new Map(data.outlets.map((o) => [o.id, o])), [data.outlets]);

  // When looking at the billed queue, group by the outlet's field agent so stock/admin can
  // hand over everything a route needs in one dispatch instead of one click per order. Only
  // surfaced when there's actually more than one order to combine.
  const agentGroups = useMemo(() => {
    if (filter !== "BILLED" || !canDispatch) return [];
    const groups = new Map<string, { key: string; agentName: string; orders: OrderDTO[]; total: number }>();
    for (const o of orders) {
      const outlet = outletById.get(o.outletId);
      const key = outlet?.agentId ?? "__none__";
      const agentName = outlet?.agentName ?? "No field agent assigned";
      const g = groups.get(key) ?? { key, agentName, orders: [], total: 0 };
      g.orders.push(o);
      g.total = round2(g.total + o.totalAmount);
      groups.set(key, g);
    }
    return [...groups.values()].filter((g) => g.orders.length > 1).sort((a, b) => b.orders.length - a.orders.length);
  }, [orders, filter, canDispatch, outletById]);

  const [bulkDispatchingKey, setBulkDispatchingKey] = useState<string | null>(null);
  async function dispatchGroup(g: { key: string; agentName: string; orders: OrderDTO[] }) {
    setBulkDispatchingKey(g.key);
    setMessage(null);
    try {
      const { orders: dispatched } = await api.dispatchBulk({ orderIds: g.orders.map((o) => o.id) });
      setMessage({ kind: "success", text: `${dispatched.length} orders dispatched for ${g.agentName} — stock deducted` });
      await onSaved();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to dispatch orders" });
    } finally {
      setBulkDispatchingKey(null);
    }
  }
  const canCancel = (o: OrderDTO) =>
    user.role === "admin"
      ? o.fulfilmentStatus !== "CANCELLED" && o.paidAmount === 0
      : user.role === "agent" && o.fulfilmentStatus === "PENDING" && o.paidAmount === 0;
  const canEdit = (o: OrderDTO) => user.role === "admin" && o.fulfilmentStatus === "PENDING";

  const [downloading, setDownloading] = useState(false);
  async function downloadCsv() {
    setDownloading(true);
    setMessage(null);
    try {
      await api.downloadOrdersCsv(filter === "ALL" ? undefined : filter);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to download CSV" });
    } finally {
      setDownloading(false);
    }
  }

  async function run(id: string, action: () => Promise<OrderDTO>, success: string) {
    setBusyId(id);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "success", text: success });
      await onSaved();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                filter === f.id ? "border-primary bg-primary text-white" : "border-input bg-card text-muted-foreground hover:bg-secondary"
              }`}
            >
              {f.label} <span className="opacity-70">({counts[f.id]})</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary shrink-0" disabled={downloading || orders.length === 0} onClick={() => void downloadCsv()}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download CSV
        </button>
      </div>

      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      {agentGroups.length > 0 && (
        <div className="space-y-2">
          {agentGroups.map((g) => (
            <div key={g.key} className="card flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{g.agentName}</p>
                <p className="text-xs text-muted-foreground">
                  {g.orders.length} orders ready · {formatMoney(g.total)} combined
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary h-10 shrink-0 text-sm"
                disabled={bulkDispatchingKey === g.key}
                onClick={() => void dispatchGroup(g)}
              >
                {bulkDispatchingKey === g.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                Dispatch all {g.orders.length}
              </button>
            </div>
          ))}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="card">
          <EmptyState>No orders here.</EmptyState>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((o) => {
            const busy = busyId === o.id;
            const outletGst = outletById.get(o.outletId)?.gstNumber ?? null;
            return (
              <article key={o.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`font-mono text-sm font-semibold ${o.invoiceNumber ? "" : "text-muted-foreground"}`}>
                      {o.invoiceNumber ? `Bill #${o.invoiceNumber}` : "Not billed yet"}
                    </p>
                    <p className="truncate font-medium">{o.outletName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(o.createdAt)}
                      {user.role !== "agent" && <> · by {o.staffName}</>}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">GSTIN: {outletGst ?? "Not on file"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <FulfilmentBadge status={o.fulfilmentStatus} />
                    <StatusBadge status={o.status} />
                  </div>
                </div>

                <ul className="my-3 space-y-1.5 border-y border-border py-2 text-sm">
                  {o.items.map((i) => {
                    const { basic, gst } = splitBasicAndGst(i.subtotal);
                    return (
                      <li key={i.productId}>
                        <div className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {i.quantity} × {i.productName}
                          </span>
                          <span className="shrink-0 tabular-nums font-medium">{formatMoney(i.subtotal)}</span>
                        </div>
                        <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                          <span>Basic {formatMoney(basic)}</span>
                          <span className="tabular-nums">GST {formatMoney(gst)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {(() => {
                  const { basic, gst } = splitBasicAndGst(o.totalAmount);
                  return (
                    <dl className="mb-2 grid grid-cols-2 gap-2 border-b border-border pb-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Basic price</dt>
                        <dd className="tabular-nums">{formatMoney(basic)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">GST</dt>
                        <dd className="tabular-nums">{formatMoney(gst)}</dd>
                      </div>
                    </dl>
                  );
                })()}
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Total</dt>
                    <dd className="font-semibold tabular-nums">{formatMoney(o.totalAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd className="tabular-nums text-success-foreground">{formatMoney(o.paidAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Balance</dt>
                    <dd className="tabular-nums text-warning-foreground">{formatMoney(o.balanceDue)}</dd>
                  </div>
                </dl>

                {o.billedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Billed {formatDate(o.billedAt)}
                    {o.billedByName && <> by {o.billedByName}</>}
                  </p>
                )}
                {o.dispatchedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Dispatched {formatDate(o.dispatchedAt)}
                    {o.dispatchedByName && <> by {o.dispatchedByName}</>}
                  </p>
                )}
                {o.cancelledAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cancelled {formatDate(o.cancelledAt)}
                    {o.cancelledByName && <> by {o.cancelledByName}</>}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {canBill && o.fulfilmentStatus === "PENDING" && (
                    <button className="btn btn-primary h-11 flex-1 text-sm" disabled={busy} onClick={() => setBilling(o)}>
                      <FileCheck className="h-4 w-4" /> Bill order
                    </button>
                  )}
                  {canDispatch && o.fulfilmentStatus === "BILLED" && (
                    <button
                      className="btn btn-primary h-11 flex-1 text-sm"
                      disabled={busy}
                      onClick={() => void run(o.id, () => api.dispatchOrder(o.id), `${orderLabel(o)} dispatched — stock deducted`)}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                      Dispatch
                    </button>
                  )}
                  {canEdit(o) && (
                    <button className="btn btn-secondary h-11 text-sm" disabled={busy} onClick={() => setEditing(o)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                  )}
                  {canCancel(o) && (
                    <button
                      className="btn btn-secondary h-11 flex-1 text-sm text-danger-foreground"
                      disabled={busy}
                      onClick={() => setConfirmingCancel(o)}
                    >
                      <Ban className="h-4 w-4" /> Cancel order
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal open={!!billing} title="Bill this order" onClose={() => setBilling(null)}>
        {billing && (
          <BillOrderForm
            order={billing}
            onDone={async (text) => {
              setBilling(null);
              setMessage({ kind: "success", text });
              await onSaved();
            }}
          />
        )}
      </Modal>

      <Modal open={!!editing} title={`Edit order — ${editing?.outletName ?? ""}`} onClose={closeEdit}>
        {editing && (
          <EditOrderForm
            key={editing.id}
            order={editing}
            data={data}
            onDone={async (text) => {
              setEditing(null);
              setMessage({ kind: "success", text });
              await onSaved();
            }}
          />
        )}
      </Modal>

      <Modal open={!!confirmingCancel} title="Cancel this order?" onClose={() => setConfirmingCancel(null)}>
        {confirmingCancel && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-warning p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
              <div className="text-sm">
                <p className="font-semibold">{orderLabel(confirmingCancel)} — {confirmingCancel.outletName}</p>
                <p className="mt-1 text-foreground">
                  {formatMoney(confirmingCancel.totalAmount)}
                  {confirmingCancel.fulfilmentStatus === "DISPATCHED" && " · its stock will be returned"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-secondary h-12 text-base" onClick={() => setConfirmingCancel(null)}>
                Keep order
              </button>
              <button
                className="btn h-12 bg-danger-foreground text-base text-white hover:bg-danger-foreground"
                disabled={busyId === confirmingCancel.id}
                onClick={() => {
                  const order = confirmingCancel;
                  setConfirmingCancel(null);
                  void run(order.id, () => api.cancelOrder(order.id), `${orderLabel(order)} cancelled`);
                }}
              >
                {busyId === confirmingCancel.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                Yes, cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface EditLine {
  productId: string;
  quantity: number;
}

function EditOrderForm({
  order,
  data,
  onDone,
}: {
  order: OrderDTO;
  data: DashboardData;
  onDone: (message: string) => Promise<void>;
}) {
  const [outletId, setOutletId] = useState(order.outletId);
  const [lines, setLines] = useState<EditLine[]>(order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
  const [addProductId, setAddProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const total = round2(lines.reduce((s, l) => s + (productById.get(l.productId)?.unitPrice ?? 0) * l.quantity, 0));
  const tooLow = total < order.paidAmount;

  const setQty = (productId: string, quantity: number) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(1, quantity) } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateOrder(order.id, { outletId, items: lines });
      await onDone(`${orderLabel(order)} updated`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update order");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="edit-outlet">Outlet</label>
        <Combobox
          id="edit-outlet"
          value={outletId}
          onChange={setOutletId}
          ariaLabel="Outlet"
          options={data.outlets.map((o) => ({ value: o.id, label: o.name }))}
        />
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {lines.map((l) => {
          const p = productById.get(l.productId);
          return (
            <li key={l.productId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{p?.name ?? l.productId}</span>
              <button type="button" className="rounded p-1 hover:bg-secondary" onClick={() => setQty(l.productId, l.quantity - 1)} aria-label="Decrease">
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={1}
                className="input w-16 px-2 py-1 text-center"
                value={l.quantity}
                onChange={(e) => setQty(l.productId, Number.parseInt(e.target.value, 10) || 1)}
                aria-label={`Quantity of ${p?.name ?? "item"}`}
              />
              <button type="button" className="rounded p-1 hover:bg-secondary" onClick={() => setQty(l.productId, l.quantity + 1)} aria-label="Increase">
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-danger hover:text-danger-foreground disabled:opacity-30"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                aria-label="Remove item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        <Combobox
          className="flex-1"
          value={addProductId}
          onChange={setAddProductId}
          placeholder="Add a product…"
          ariaLabel="Add product"
          options={data.products
            .filter((p) => !lines.some((l) => l.productId === p.id))
            .map((p) => ({ value: p.id, label: p.name }))}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!addProductId}
          onClick={() => {
            setLines((prev) => [...prev, { productId: addProductId, quantity: 1 }]);
            setAddProductId("");
          }}
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <div className="flex justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
        <span className="text-muted-foreground">New total</span>
        <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
      </div>
      {tooLow && <Alert kind="warning">The new total is less than the {formatMoney(order.paidAmount)} already paid.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <button type="submit" className="btn btn-primary w-full" disabled={busy || tooLow}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
        Save changes
      </button>
    </form>
  );
}

/** Copies in the physical bill-book number by hand — never auto-generated. */
function BillOrderForm({ order, onDone }: { order: OrderDTO; onDone: (message: string) => Promise<void> }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceNumber.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.billOrder(order.id, { invoiceNumber: invoiceNumber.trim() });
      await onDone(`Bill #${invoiceNumber.trim()} recorded — ready to dispatch`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to bill order");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg bg-secondary px-3 py-2 text-sm">
        <p className="font-medium">{order.outletName}</p>
        <p className="text-muted-foreground">{formatMoney(order.totalAmount)} · {order.items.length} item{order.items.length === 1 ? "" : "s"}</p>
      </div>
      <div>
        <label className="label" htmlFor="bill-number">Bill book number</label>
        <input
          id="bill-number"
          className="input"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          placeholder="e.g. 1042"
          autoFocus
        />
        <p className="mt-1 text-xs text-muted-foreground">Copy this from the physical bill book — it can't be changed later.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !invoiceNumber.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
        Save bill number
      </button>
    </form>
  );
}
