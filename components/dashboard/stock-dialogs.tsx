"use client";

import { useState } from "react";
import { Loader2, Pencil, SlidersHorizontal } from "lucide-react";
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
      <p className="text-sm text-slate-600">
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
      <p className={`text-sm ${after < 0 ? "font-medium text-red-600" : "text-slate-600"}`}>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceNum = Number.parseFloat(price);
  const valid = name.trim().length > 0 && priceNum > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateProduct(product.id, { name: name.trim(), unitPrice: priceNum });
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
      <p className="text-xs text-slate-500">Price changes apply to new orders only; existing orders keep their prices.</p>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
        Save
      </button>
    </form>
  );
}
