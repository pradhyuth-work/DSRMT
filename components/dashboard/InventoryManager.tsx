"use client";

import { useCallback, useState } from "react";
import { History, Loader2, PackagePlus, Pencil, PlusCircle, SlidersHorizontal, Upload } from "lucide-react";
import type { ProductDTO, Role, StockMovementDTO, StockMovementType } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import { AdjustStockForm, EditProductForm } from "./stock-dialogs";
import BulkReceiveModal from "./BulkReceiveModal";

const LOW_STOCK_THRESHOLD = 10;

const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  RECEIVE: "Received",
  ADJUST: "Adjusted",
  DISPATCH: "Dispatched",
  CANCEL_RETURN: "Returned (cancelled)",
};

type Dialog = { kind: "adjust" | "edit"; product: ProductDTO } | { kind: "bulk" } | null;

/**
 * Receiving and adjusting stock, adding products, and editing them are all admin-only now
 * (stock incharge dispatches orders and collects payments, but no longer touches stock
 * quantities). Stock incharge still gets this tab, read-only, to see levels and history.
 */
export default function InventoryManager({
  products,
  movements,
  role,
  onSaved,
}: {
  products: ProductDTO[];
  movements: StockMovementDTO[];
  role: Role;
  onSaved: () => Promise<void>;
}) {
  const canManage = role === "admin";
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const done = async (text: string) => {
    setDialog(null);
    setMessage({ kind: "success", text });
    await onSaved();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {canManage && (
        <AddProductForm
          onSaved={async (text) => {
            setMessage({ kind: "success", text });
            await onSaved();
          }}
        />
      )}

      <div className={`space-y-4 ${canManage ? "lg:col-span-2" : "lg:col-span-3"}`}>
        {message && <Alert kind={message.kind}>{message.text}</Alert>}

        {canManage && (
          <div className="flex justify-end">
            <button className="btn btn-secondary" onClick={() => setDialog({ kind: "bulk" })}>
              <Upload className="h-4 w-4" /> Bulk receive stock
            </button>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800">
              <thead className="bg-slate-800/60">
                <tr>
                  <th className="th">#</th>
                  <th className="th">Product</th>
                  <th className="th text-right">Unit Price</th>
                  <th className="th text-right">In Stock</th>
                  {canManage && <th className="th text-right">Receive</th>}
                  {canManage && <th className="th text-right">Manage</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/60">
                    <td className="td text-slate-500">#{p.productCode}</td>
                    <td className="td font-medium">{p.name}</td>
                    <td className="td text-right tabular-nums">{formatMoney(p.unitPrice)}</td>
                    <td className="td text-right">
                      <StockBadge qty={p.stockQty ?? 0} />
                    </td>
                    {canManage && (
                      <td className="td">
                        <RestockControl
                          product={p}
                          onResult={async (ok, text) => {
                            setMessage({ kind: ok ? "success" : "error", text });
                            if (ok) await onSaved();
                          }}
                        />
                      </td>
                    )}
                    {canManage && (
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn btn-secondary px-2.5"
                            onClick={() => setDialog({ kind: "adjust", product: p })}
                            aria-label={`Adjust stock for ${p.name}`}
                            title="Adjust stock"
                          >
                            <SlidersHorizontal className="h-4 w-4" />
                          </button>
                          <button
                            className="btn btn-secondary px-2.5"
                            onClick={() => setDialog({ kind: "edit", product: p })}
                            aria-label={`Edit ${p.name}`}
                            title="Edit name or price"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {products.length === 0 && <EmptyState>No products yet{canManage ? " — add one to get started." : "."}</EmptyState>}
        </div>

        <div className="card">
          <h2 className="flex items-center gap-2 border-b border-slate-800 px-5 py-3 font-semibold">
            <History className="h-4 w-4 text-blue-400" /> Stock movements
          </h2>
          {movements.length === 0 ? (
            <EmptyState>No stock movements yet.</EmptyState>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
              {movements.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.productName}</p>
                    <p className="text-xs text-slate-400">
                      {MOVEMENT_LABEL[m.type]}
                      {m.invoiceId && <> · {m.invoiceId}</>}
                      {m.reason && <> · {m.reason}</>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(m.createdAt)} · {m.staffName}
                    </p>
                  </div>
                  <span className={`shrink-0 font-semibold tabular-nums ${m.change > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {m.change > 0 ? "+" : ""}
                    {m.change}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={!!dialog}
        title={
          dialog?.kind === "bulk"
            ? "Bulk receive stock"
            : dialog
              ? `${dialog.kind === "adjust" ? "Adjust stock" : "Edit product"} — ${dialog.product.name}`
              : ""
        }
        onClose={closeDialog}
      >
        {dialog?.kind === "adjust" && <AdjustStockForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "edit" && <EditProductForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "bulk" && <BulkReceiveModal onDone={done} />}
      </Modal>
    </div>
  );
}

function StockBadge({ qty }: { qty: number }) {
  const style =
    qty === 0 ? "bg-red-500/15 text-red-400" : qty < LOW_STOCK_THRESHOLD ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${style}`}>{qty}</span>;
}

function RestockControl({ product, onResult }: { product: ProductDTO; onResult: (ok: boolean, text: string) => Promise<void> }) {
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number.parseInt(qty, 10);
  const valid = Number.isInteger(n) && n > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const updated = await api.restock(product.id, { quantity: n });
      setQty("");
      await onResult(true, `Restocked ${updated.name}: +${n} (now ${updated.stockQty})`);
    } catch (err) {
      await onResult(false, err instanceof Error ? err.message : "Restock failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex justify-end gap-2">
      <input
        type="number"
        min={1}
        step={1}
        placeholder="Qty"
        className="input w-24"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        aria-label={`Restock quantity for ${product.name}`}
      />
      <button type="submit" className="btn btn-secondary px-3" disabled={!valid || busy} aria-label="Restock">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
      </button>
    </form>
  );
}

function AddProductForm({ onSaved }: { onSaved: (text: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [productCode, setProductCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceNum = Number.parseFloat(price);
  const stockNum = Number.parseInt(stock, 10);
  const codeNum = productCode.trim() ? Number.parseInt(productCode, 10) : undefined;
  const valid = name.trim().length > 0 && priceNum > 0 && Number.isInteger(stockNum) && stockNum >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createProduct({ name: name.trim(), unitPrice: priceNum, stockQty: stockNum, productCode: codeNum });
      setName("");
      setPrice("");
      setStock("0");
      setProductCode("");
      await onSaved(`Added #${created.productCode} ${created.name} with ${created.stockQty} units`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <PackagePlus className="h-5 w-5 text-blue-400" /> Add product
      </h2>
      <div>
        <label className="label" htmlFor="p-name">Name</label>
        <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Soda 300ml (Case of 24)" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="p-price">Unit price (₹)</label>
          <input id="p-price" type="number" min={0.01} step="0.01" className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="p-stock">Opening stock</label>
          <input id="p-stock" type="number" min={0} step={1} className="input" value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="p-code">Product ID</label>
        <input id="p-code" type="number" min={1} step={1} className="input" value={productCode} onChange={(e) => setProductCode(e.target.value)} placeholder="Optional — next free number by default" />
        <p className="mt-1 text-xs text-slate-400">If this number is already used, that product (and every later one) shifts up by one.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
        Add product
      </button>
    </form>
  );
}
