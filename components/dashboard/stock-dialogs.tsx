"use client";

import { useState } from "react";
import { Hash, Loader2, Pencil, PlusCircle, SlidersHorizontal } from "lucide-react";
import type { ProductDTO } from "@/lib/types";
import { api } from "./api-client";
import { Alert } from "./ui";

/** Adjust stock up or down with a mandatory reason. The server refuses to go below zero. */
export function AdjustStockForm({ product, onDone }: { product: ProductDTO; onDone: (message: string) => Promise<void> }) {
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number.parseInt(qty, 10);
  const change = direction === "add" ? n : -n;
  const current = product.stockQty ?? 0;
  const after = current + (Number.isInteger(n) ? change : 0);
  const valid = Number.isInteger(n) && n > 0 && reason.trim().length >= 3 && after >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adjustStock(product.id, { change, reason: reason.trim() });
      await onDone(`Adjusted ${updated.name} by ${change > 0 ? "+" : ""}${change} (now ${updated.stockQty})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Current stock: <span className="font-semibold tabular-nums">{current}</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["remove", "add"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDirection(d)} className={`btn ${direction === d ? "btn-primary" : "btn-secondary"}`}>
            {d === "add" ? "Add (+)" : "Remove (−)"}
          </button>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="adj-qty">Quantity</label>
        <input id="adj-qty" type="number" min={1} step={1} className="input" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="adj-reason">Reason</label>
        <input
          id="adj-reason"
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Damaged in transit, stock count correction"
          maxLength={200}
        />
      </div>
      <p className={`text-sm ${after < 0 ? "font-medium text-danger-foreground" : "text-muted-foreground"}`}>
        After adjustment: <span className="font-semibold tabular-nums">{after}</span>
        {after < 0 && " — stock can't go below zero"}
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
        Save adjustment
      </button>
    </form>
  );
}

export function EditProductForm({ product, onDone }: { product: ProductDTO; onDone: (message: string) => Promise<void> }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.unitPrice));
  const storedSchemePrice = product.schemeStoredPrice ?? product.schemePrice;
  const [schemePrice, setSchemePrice] = useState(storedSchemePrice != null ? String(storedSchemePrice) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceNum = Number.parseFloat(price);
  const schemePriceNum = schemePrice.trim() === "" ? null : Number.parseFloat(schemePrice);
  const valid = name.trim().length > 0 && priceNum > 0 && (schemePriceNum === null || schemePriceNum > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      // Only send schemePrice when it actually changed — resending the unchanged stored
      // value would flip schemeActive back on (see the PATCH route) even when this edit
      // was just a name/price fix made while scheme pricing was deliberately switched off.
      const schemePriceChanged = schemePriceNum !== (storedSchemePrice ?? null);
      const updated = await api.updateProduct(product.id, {
        name: name.trim(),
        unitPrice: priceNum,
        ...(schemePriceChanged ? { schemePrice: schemePriceNum } : {}),
      });
      await onDone(`Updated ${updated.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="ep-name">Name</label>
        <input id="ep-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ep-price">Unit price (₹)</label>
        <input id="ep-price" type="number" min={0.01} step="0.01" className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ep-scheme-price">Scheme price (₹)</label>
        <input
          id="ep-scheme-price"
          type="number"
          min={0.01}
          step="0.01"
          className="input"
          placeholder="Leave blank if this product has no scheme"
          value={schemePrice}
          onChange={(e) => setSchemePrice(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">Used when an order is toggled &quot;with scheme&quot; — leave blank to block that toggle for this product.</p>
      </div>
      <p className="text-xs text-muted-foreground">Price changes apply to new orders only; existing orders keep their prices.</p>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
        Save
      </button>
    </form>
  );
}

/** Receive stock for one product, with an optional supplier/bill reference recorded
 * against the RECEIVE movement it creates. */
export function RestockForm({ product, onDone }: { product: ProductDTO; onDone: (message: string) => Promise<void> }) {
  const [qty, setQty] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number.parseInt(qty, 10);
  const valid = Number.isInteger(n) && n > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.restock(product.id, { quantity: n, supplierRef: supplierRef.trim() || undefined });
      await onDone(`Restocked ${updated.name}: +${n} (now ${updated.stockQty})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restock failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Current stock: <span className="font-semibold tabular-nums">{product.stockQty ?? 0}</span>
      </p>
      <div>
        <label className="label" htmlFor="rs-qty">Quantity received</label>
        <input id="rs-qty" type="number" min={1} step={1} className="input" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="rs-supplier">Supplier / bill reference</label>
        <input
          id="rs-supplier"
          className="input"
          value={supplierRef}
          onChange={(e) => setSupplierRef(e.target.value)}
          placeholder="Optional — e.g. supplier name or bill number"
          maxLength={120}
        />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
        Receive stock
      </button>
    </form>
  );
}

/** Explicitly renumbers a product's #code. Reuses the same shift-on-collision behaviour as
 * creating a product at a taken code — only the products between the old and new position move. */
export function ChangeCodeForm({ product, onDone }: { product: ProductDTO; onDone: (message: string) => Promise<void> }) {
  const [newCode, setNewCode] = useState(String(product.productCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number.parseInt(newCode, 10);
  const valid = Number.isInteger(n) && n > 0 && n !== product.productCode;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.changeProductCode(product.id, { newCode: n });
      await onDone(`${updated.name} is now #${updated.productCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change product code");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Current code: <span className="font-semibold tabular-nums">#{product.productCode}</span>
      </p>
      <div>
        <label className="label" htmlFor="cc-code">New code</label>
        <input id="cc-code" type="number" min={1} step={1} className="input" value={newCode} onChange={(e) => setNewCode(e.target.value)} autoFocus />
        <p className="mt-1 text-xs text-muted-foreground">If this number is already used, only the products between the old and new position shift by one.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hash className="h-4 w-4" />}
        Save new code
      </button>
    </form>
  );
}
