"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Hash, History, Loader2, PackagePlus, Pencil, PlusCircle, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import type { ProductDTO, Role, StockMovementDTO, StockMovementType } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import { AdjustStockForm, ChangeCodeForm, EditProductForm, RestockForm } from "./stock-dialogs";
import BulkReceiveModal from "./BulkReceiveModal";
import BulkRateModal from "./BulkRateModal";

const LOW_STOCK_THRESHOLD = 10;

const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  RECEIVE: "Received",
  ADJUST: "Adjusted",
  DISPATCH: "Dispatched",
  CANCEL_RETURN: "Returned (cancelled)",
};

type Dialog = { kind: "adjust" | "edit" | "restock" | "code"; product: ProductDTO } | { kind: "bulk" } | { kind: "bulk-rate" } | null;

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
  const [deletingProduct, setDeletingProduct] = useState<ProductDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [range, setRange] = useState<DateRange>({});
  const [rangedMovements, setRangedMovements] = useState<StockMovementDTO[] | null>(null);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const done = async (text: string) => {
    setDialog(null);
    setMessage({ kind: "success", text });
    await onSaved();
  };

  // The movements prop is the unfiltered recent log loaded with the rest of the dashboard;
  // picking a date range fetches a scoped list instead, same self-fetch pattern used
  // elsewhere for date-filtered reports (StaffPerformance, Payments).
  const loadRanged = useCallback(async () => {
    if (!range.from && !range.to) {
      setRangedMovements(null);
      return;
    }
    try {
      setRangedMovements(await api.stockMovements(range));
      setMovementsError(null);
    } catch (err) {
      setMovementsError(err instanceof Error ? err.message : "Failed to load stock movements");
    }
  }, [range]);

  useEffect(() => {
    void loadRanged();
  }, [loadRanged]);

  const visibleMovements = rangedMovements ?? movements;

  async function confirmDeleteProduct() {
    if (!deletingProduct) return;
    setDeleting(true);
    try {
      await api.deleteProduct(deletingProduct.id);
      setMessage({ kind: "success", text: `${deletingProduct.name} deleted` });
      setDeletingProduct(null);
      await onSaved();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to delete product" });
    } finally {
      setDeleting(false);
    }
  }

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
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setDialog({ kind: "bulk-rate" })}>
              <Upload className="h-4 w-4" /> Bulk update rates
            </button>
            <button className="btn btn-secondary" onClick={() => setDialog({ kind: "bulk" })}>
              <Upload className="h-4 w-4" /> Bulk receive stock
            </button>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="th">#</th>
                  <th className="th">Product</th>
                  <th className="th text-right">Unit Price</th>
                  <th className="th text-right">Scheme Price</th>
                  <th className="th text-right">In Stock</th>
                  {canManage && <th className="th text-right">Manage</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-secondary">
                    <td className="td text-muted-foreground">#{p.productCode}</td>
                    <td className="td font-medium">{p.name}</td>
                    <td className="td text-right tabular-nums">{formatMoney(p.unitPrice)}</td>
                    <td className="td text-right tabular-nums text-muted-foreground">
                      {p.schemePrice != null ? formatMoney(p.schemePrice) : "—"}
                    </td>
                    <td className="td text-right">
                      <StockBadge qty={p.stockQty ?? 0} />
                    </td>
                    {canManage && (
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn btn-secondary px-2.5"
                            onClick={() => setDialog({ kind: "restock", product: p })}
                            aria-label={`Receive stock for ${p.name}`}
                            title="Receive stock"
                          >
                            <PlusCircle className="h-4 w-4" />
                          </button>
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
                            onClick={() => setDialog({ kind: "code", product: p })}
                            aria-label={`Change code for ${p.name}`}
                            title="Change code"
                          >
                            <Hash className="h-4 w-4" />
                          </button>
                          <button
                            className="btn btn-secondary px-2.5"
                            onClick={() => setDialog({ kind: "edit", product: p })}
                            aria-label={`Edit ${p.name}`}
                            title="Edit name or price"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            className="btn btn-secondary px-2.5 text-danger-foreground"
                            onClick={() => setDeletingProduct(p)}
                            aria-label={`Delete ${p.name}`}
                            title="Delete product"
                          >
                            <Trash2 className="h-4 w-4" />
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4 text-primary" /> Stock movements
            </h2>
            <DateRangeFilter value={range} onChange={setRange} />
          </div>
          {movementsError && (
            <div className="px-5 py-3">
              <Alert kind="error">{movementsError}</Alert>
            </div>
          )}
          {visibleMovements.length === 0 ? (
            <EmptyState>No stock movements {range.from || range.to ? "in this range" : "yet"}.</EmptyState>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {visibleMovements.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="flex min-w-0 items-start gap-2">
                    {m.direction === "IN" ? (
                      <ArrowDownCircle className="mt-0.5 h-4 w-4 shrink-0 text-success-foreground" />
                    ) : (
                      <ArrowUpCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {MOVEMENT_LABEL[m.type]}
                        {m.invoiceId && <> · {m.invoiceId}</>}
                        {m.reason && <> · {m.reason}</>}
                        {m.supplierRef && <> · {m.supplierRef}</>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(m.createdAt)} · {m.staffName}
                      </p>
                    </div>
                  </div>
                  <span className={`shrink-0 font-semibold tabular-nums ${m.change > 0 ? "text-success-foreground" : "text-danger-foreground"}`}>
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
        title={dialogTitle(dialog)}
        onClose={closeDialog}
        wide={dialog?.kind === "bulk" || dialog?.kind === "bulk-rate"}
      >
        {dialog?.kind === "adjust" && <AdjustStockForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "restock" && <RestockForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "code" && <ChangeCodeForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "edit" && <EditProductForm key={dialog.product.id} product={dialog.product} onDone={done} />}
        {dialog?.kind === "bulk" && <BulkReceiveModal onDone={done} />}
        {dialog?.kind === "bulk-rate" && <BulkRateModal products={products} onDone={done} />}
      </Modal>

      <Modal open={!!deletingProduct} title="Delete this product?" onClose={() => setDeletingProduct(null)}>
        {deletingProduct && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-warning p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
              <div className="text-sm">
                <p className="font-semibold">#{deletingProduct.productCode} {deletingProduct.name}</p>
                <p className="mt-1 text-foreground">Refused if it's ever been on an order.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-secondary h-12 text-base" onClick={() => setDeletingProduct(null)}>
                Keep product
              </button>
              <button
                className="btn h-12 bg-danger-foreground text-base text-white hover:bg-danger-foreground"
                disabled={deleting}
                onClick={() => void confirmDeleteProduct()}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Yes, delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const DIALOG_TITLE: Record<"adjust" | "edit" | "restock" | "code", string> = {
  adjust: "Adjust stock",
  restock: "Receive stock",
  code: "Change code",
  edit: "Edit product",
};

function dialogTitle(dialog: Dialog): string {
  if (!dialog) return "";
  if (dialog.kind === "bulk") return "Bulk receive stock";
  if (dialog.kind === "bulk-rate") return "Bulk update rates";
  return `${DIALOG_TITLE[dialog.kind]} — ${dialog.product.name}`;
}

function StockBadge({ qty }: { qty: number }) {
  const style =
    qty === 0 ? "bg-danger text-danger-foreground" : qty < LOW_STOCK_THRESHOLD ? "bg-warning text-warning-foreground" : "bg-success text-success-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${style}`}>{qty}</span>;
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
        <PackagePlus className="h-5 w-5 text-primary" /> Add product
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
        <p className="mt-1 text-xs text-muted-foreground">If this number is already used, that product (and every later one) shifts up by one.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
        Add product
      </button>
    </form>
  );
}
