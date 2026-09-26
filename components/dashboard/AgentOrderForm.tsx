"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  ChevronLeft,
  IndianRupee,
  Loader2,
  Minus,
  Package,
  PackageX,
  Plus,
  Search,
  ShoppingBag,
  Smartphone,
  Store,
} from "lucide-react";
import type { AuthUser, CreateSaleResponse, PaymentMethod } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert } from "./ui";
import type { DashboardData } from "./Dashboard";

type Step = "outlet" | "browse" | "review" | "done";

/**
 * The field-agent order screen: big tappable cards and steppers instead of dropdowns and
 * typing, one thing to decide at a time. Optimised for one-handed phone use in the field.
 * Admins use the fuller SaleForm instead — this is agent-only.
 */
export default function AgentOrderForm({
  data,
  user,
  onSaved,
}: {
  data: DashboardData;
  user: AuthUser;
  onSaved: () => Promise<void>;
}) {
  const { products, outlets } = data;
  const singleOutlet = outlets.length === 1 ? outlets[0] : null;

  const [outletId, setOutletId] = useState<string | null>(singleOutlet?.id ?? null);
  const [step, setStep] = useState<Step>(singleOutlet ? "browse" : "outlet");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [paidNow, setPaidNow] = useState(false);
  const [paid, setPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<CreateSaleResponse["invoice"] | null>(null);
  const paymentSectionRef = useRef<HTMLDivElement>(null);

  // The fixed bottom bar can otherwise hide the amount/method fields the moment they
  // appear, with no hint to scroll — bring them into view automatically instead.
  useEffect(() => {
    if (paidNow) paymentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [paidNow]);

  const outlet = outlets.find((o) => o.id === outletId) ?? null;

  const cartItems = useMemo(
    () =>
      Object.entries(qtyByProduct)
        .filter(([, qty]) => qty > 0)
        .map(([productId, quantity]) => {
          const product = products.find((p) => p.id === productId)!;
          return { product, quantity, subtotal: round2(product.unitPrice * quantity) };
        }),
    [qtyByProduct, products],
  );
  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0);
  const total = round2(cartItems.reduce((s, i) => s + i.subtotal, 0));

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const setQty = (productId: string, qty: number) =>
    setQtyByProduct((prev) => ({ ...prev, [productId]: Math.max(0, qty) }));

  const paidNum = paidNow ? Number.parseFloat(paid) || 0 : 0;
  const overpaid = paidNum > total;

  function resetForNextOrder() {
    setQtyByProduct({});
    setSearch("");
    setPaidNow(false);
    setPaid("");
    setPaymentMethod("CASH");
    setLastInvoice(null);
    setError(null);
    setStep("browse");
  }

  async function placeOrder() {
    if (!outletId || cartItems.length === 0 || overpaid) return;
    setSubmitting(true);
    setError(null);
    try {
      const { invoice } = await api.createSale({
        outletId,
        items: cartItems.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        paidAmount: paidNum,
        paymentMethod,
      });
      setLastInvoice(invoice);
      setStep("done");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- No outlets assigned at all ----
  if (outlets.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <PackageX className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-semibold">No outlet assigned yet</p>
        <p className="text-muted-foreground">Ask your admin to assign an outlet to you before you can take orders.</p>
      </div>
    );
  }

  // ---- Step: pick an outlet (only when there's more than one) ----
  if (step === "outlet") {
    return (
      <div className="space-y-3">
        <h2 className="px-1 text-lg font-semibold">Which outlet is this order for?</h2>
        <div className="space-y-3">
          {outlets.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setOutletId(o.id);
                setStep("browse");
              }}
              className="card flex w-full items-center gap-4 p-5 text-left transition active:scale-[0.99] active:bg-secondary"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <Store className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold">{o.name}</span>
                {o.phone && <span className="block text-sm text-muted-foreground">{o.phone}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Step: order placed ----
  if (step === "done" && lastInvoice) {
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success text-success-foreground">
          <Check className="h-9 w-9" />
        </span>
        <div>
          <p className="text-xl font-bold">Order placed!</p>
          <p className="mt-1 text-muted-foreground">{outlet?.name}</p>
        </div>
        <div className="w-full max-w-xs space-y-2 rounded-xl bg-secondary p-4 text-left text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Order</span>
            <span className="font-mono font-semibold">{lastInvoice.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{formatMoney(lastInvoice.totalAmount)}</span>
          </div>
          {lastInvoice.paidAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Collected now</span>
              <span className="font-semibold text-success-foreground">{formatMoney(lastInvoice.paidAmount)}</span>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Waiting to be dispatched — you can track it under My orders.</p>
        <button className="btn btn-primary h-14 w-full max-w-xs text-base" onClick={resetForNextOrder}>
          <Plus className="h-5 w-5" /> Start a new order
        </button>
      </div>
    );
  }

  // ---- Step: review & confirm ----
  if (step === "review") {
    return (
      <div className="space-y-4 pb-28">
        <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground" onClick={() => setStep("browse")}>
          <ChevronLeft className="h-4 w-4" /> Back to products
        </button>

        <div className="card p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Store className="h-4 w-4 text-primary" /> {outlet?.name}
          </p>
        </div>

        <div className="card divide-y divide-border">
          {cartItems.map((item) => (
            <div key={item.product.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.product.name}</p>
                <p className="text-sm text-muted-foreground">{formatMoney(item.product.unitPrice)} each</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Stepper value={item.quantity} onChange={(q) => setQty(item.product.id, q)} />
                <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{formatMoney(item.subtotal)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="card p-4">
          <button
            type="button"
            className="flex w-full items-center justify-between"
            onClick={() => setPaidNow((v) => !v)}
          >
            <span className="flex items-center gap-2 font-medium">
              <IndianRupee className="h-4 w-4 text-primary" /> Did the customer pay anything now?
            </span>
            <span
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${paidNow ? "bg-primary" : "bg-secondary"}`}
              aria-hidden
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${paidNow ? "left-5" : "left-0.5"}`}
              />
            </span>
          </button>

          {paidNow && (
            <div ref={paymentSectionRef} className="mt-4 scroll-mb-32 space-y-3 pb-2">
              <div>
                <label className="label" htmlFor="paid-amount">Amount collected</label>
                <input
                  id="paid-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="input h-14 text-lg"
                  placeholder="0"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  autoFocus
                />
                <button type="button" className="mt-1.5 text-sm font-medium text-primary" onClick={() => setPaid(String(total))}>
                  Full amount ({formatMoney(total)})
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(["CASH", "UPI"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`btn h-14 text-base ${paymentMethod === m ? "btn-primary" : "btn-secondary"}`}
                  >
                    {m === "CASH" ? <Banknote className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                    {m === "CASH" ? "Cash" : "UPI"}
                  </button>
                ))}
              </div>
              {overpaid && <Alert kind="warning">That's more than the order total.</Alert>}
            </div>
          )}
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold tabular-nums">{formatMoney(total)}</p>
            </div>
            <button
              className="btn btn-primary h-14 flex-1 text-base"
              disabled={submitting || overpaid}
              onClick={() => void placeOrder()}
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              Place order
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step: browse products (default) ----
  return (
    <div className="space-y-4 pb-28">
      {outlets.length > 1 && (
        <button
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
          onClick={() => setStep("outlet")}
        >
          <Store className="h-4 w-4" /> {outlet?.name} <span className="text-primary underline">Change</span>
        </button>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input h-14 pl-11 text-base"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filteredProducts.map((p) => {
          const qty = qtyByProduct[p.id] ?? 0;
          return (
            <div
              key={p.id}
              className={`card flex flex-col gap-2 p-3 ${!p.inStock ? "opacity-50" : ""} ${qty > 0 ? "border-primary" : ""}`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  p.inStock ? "bg-secondary text-primary" : "bg-secondary text-muted-foreground"
                }`}
              >
                <Package className="h-5 w-5" />
              </span>
              <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight">{p.name}</p>
              <p className="font-semibold tabular-nums">{formatMoney(p.unitPrice)}</p>

              {!p.inStock ? (
                <p className="rounded-lg bg-secondary py-2 text-center text-xs font-medium text-muted-foreground">Out of stock</p>
              ) : qty === 0 ? (
                <button
                  className="btn btn-primary h-11 w-full"
                  onClick={() => setQty(p.id, 1)}
                  aria-label={`Add ${p.name}`}
                >
                  <Plus className="h-5 w-5" /> Add
                </button>
              ) : (
                <Stepper value={qty} onChange={(q) => setQty(p.id, q)} full />
              )}
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <p className="col-span-full py-10 text-center text-muted-foreground">No products match “{search}”.</p>
        )}
      </div>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-4 backdrop-blur">
          <button
            className="btn btn-primary mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 text-base"
            onClick={() => setStep("review")}
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              {cartCount} item{cartCount === 1 ? "" : "s"}
            </span>
            <span className="font-bold tabular-nums">{formatMoney(total)} · Review</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onChange, full }: { value: number; onChange: (q: number) => void; full?: boolean }) {
  return (
    <div className={`flex items-center gap-1 ${full ? "w-full justify-between rounded-xl bg-secondary p-1" : ""}`}>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground transition active:scale-95"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease quantity"
      >
        <Minus className="h-5 w-5" />
      </button>
      <span className="w-8 shrink-0 text-center text-base font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition active:scale-95"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}
