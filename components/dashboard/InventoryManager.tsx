"use client";

import { useCallback, useState } from "react";
import { History, Loader2, PackagePlus, Pencil, PlusCircle, SlidersHorizontal } from "lucide-react";
import type { ProductDTO, StockMovementDTO, StockMovementType } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import { AdjustStockForm, EditProductForm } from "./stock-dialogs";

const LOW_STOCK_THRESHOLD = 10;

const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  RECEIVE: "Received",
  ADJUST: "Adjusted",
  DISPATCH: "Dispatched",
  CANCEL_RETURN: "Returned (cancelled)",
};

type Dialog = { kind: "adjust" | "edit"; product: ProductDTO } | null;

export default function InventoryManager({
  products,
  movements,
  onSaved,
}: {
  products: ProductDTO[];
  movements: StockMovementDTO[];
  onSaved: () => Promise<void>;
}) {
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
      <AddProductForm
        onSaved={async (text) => {
          setMessage({ kind: "success", text });
          await onSaved();
        }}
      />

      <div className="space-y-4 lg:col-span-2">
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Product</th>
                  <th className="th text-right">Unit Price</th>
                  <th className="th text-right">In Stock</th>
                  <th className="th text-right">Receive</th>
                  <th className="th text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{p.name}</td>
                    <td className="td text-right tabular-nums">{formatMoney(p.unitPrice)}</td>
                    <td className="td text-right">
                      <StockBadge qty={p.stockQty ?? 0} />
                    </td>
                    <td className="td">
                      <RestockControl
                        product={p}
                        onResult={async (ok, text) => {
                          setMessage({ kind: ok ? "success" : "error", text });
                          if (ok) await onSaved();
                        }}
                      />
                    </td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {products.length === 0 && <EmptyState>No products yet — add one to get started.</EmptyState>}
        </div>

        <div className="card">
          <h2 className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 font-semibold">
            <History className="h-4 w-4 text-indigo-600" /> Stock movements
          </h2>
          {movements.length === 0 ? (
            <EmptyState>No stock movements yet.</EmptyState>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {movements.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.productName}</p>
                    <p className="text-xs text-slate-500">
                      {MOVEMENT_LABEL[m.type]}
                      {m.invoiceId && <> · {m.invoiceId}</>}
                      {m.reason && <> · {m.reason}</>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(m.createdAt)} · {m.staffName}
                    </p>
                  </div>
                  <span className={`shrink-0 font-semibold tabular-nums ${m.change > 0 ? "text-emerald-700" : "text-red-600"}`}>
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
        title={dialog ? `${dialog.kind === "adjust" ? "Adjust stock" : "Edit product"} — ${dialog.product.name}` : ""}
        onClose={closeDialog}
      >
        {dialog?.kind === "adjust" && <AdjustStockForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "edit" && <EditProductForm key={dialog.product.id} product={dialog.product} onDone={done} />}
      </Modal>
    </div>
  );
}

function StockBadge({ qty }: { qty: number }) {
  const style =
    qty === 0 ? "bg-red-100 text-red-700" : qty < LOW_STOCK_THRESHOLD ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceNum = Number.parseFloat(price);
  const stockNum = Number.parseInt(stock, 10);
  const valid = name.trim().length > 0 && priceNum > 0 && Number.isInteger(stockNum) && stockNum >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createProduct({ name: name.trim(), unitPrice: priceNum, stockQty: stockNum });
      setName("");
      setPrice("");
      setStock("0");
      await onSaved(`Added ${created.name} with ${created.stockQty} units`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <PackagePlus className="h-5 w-5 text-indigo-600" /> Add product
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
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
        Add product
      </button>
    </form>
  );
}
