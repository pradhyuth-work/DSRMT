"use client";

import { useMemo, useState } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import type { PaymentMethod, StaffDTO } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, formatDate } from "./ui";
import { Combobox } from "./Combobox";

export interface CollectPaymentTarget {
  outletId: string;
  outletName: string;
  balance: number;
  /** Oldest first — the order a payment settles them in. */
  openInvoices: { id: string; balanceDue: number; createdAt: string }[];
}

/**
 * The actual collection form, reused wherever a payment gets recorded against an outlet:
 * from a specific ledger row (already know the balance) or from the standalone Payments
 * tab (balance fetched on outlet selection). When `staffOptions` is omitted the payment is
 * always attributed to whoever is signed in — the server enforces this regardless of what
 * the client sends, this just matches the UI to what will actually happen.
 */
export function CollectPaymentForm({
  target,
  staffOptions,
  onDone,
}: {
  target: CollectPaymentTarget;
  staffOptions?: StaffDTO[];
  onDone: (message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(target.balance));
  const [staffId, setStaffId] = useState(staffOptions?.[0]?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number.parseFloat(amount) || 0;
  const tooMuch = amountNum > target.balance;

  // Preview how the payment will be applied, oldest invoice first (mirrors the server's FIFO logic).
  const preview = useMemo(() => {
    let remaining = round2(amountNum);
    return target.openInvoices.map((inv) => {
      const applied = round2(Math.max(0, Math.min(remaining, inv.balanceDue)));
      remaining = round2(remaining - applied);
      return { ...inv, applied, after: round2(inv.balanceDue - applied) };
    });
  }, [amountNum, target.openInvoices]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createPayment({
        outletId: target.outletId,
        staffId: staffOptions ? staffId : undefined,
        amount: amountNum,
        paymentMethod: method,
        notes: notes.trim() || undefined,
      });
      await onDone(
        `Collected ${formatMoney(res.amount)} from ${target.outletName} — applied to ${res.allocations.map((a) => a.invoiceId).join(", ")}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between rounded-lg bg-warning px-3 py-2 text-sm">
        <span className="text-warning-foreground">Outstanding balance</span>
        <span className="font-semibold tabular-nums text-warning-foreground">{formatMoney(target.balance)}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pay-amount">Amount</label>
          <input
            id="pay-amount"
            type="number"
            min={0.01}
            step="0.01"
            max={target.balance}
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        {staffOptions && (
          <div>
            <label className="label" htmlFor="pay-staff">Collected by</label>
            <Combobox
              id="pay-staff"
              value={staffId}
              onChange={setStaffId}
              options={staffOptions.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        )}
        <div>
          <span className="label">Method</span>
          <div className="grid grid-cols-2 gap-2">
            {(["CASH", "UPI"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)} className={`btn ${method === m ? "btn-primary" : "btn-secondary"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="pay-notes">Notes</label>
          <input id="pay-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <div>
        <p className="label">Settlement preview (oldest first)</p>
        {target.openInvoices.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">No outstanding invoices.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {preview.map((p) => (
              <li key={p.id} className={`flex items-center justify-between px-3 py-2 ${p.applied > 0 ? "" : "text-muted-foreground"}`}>
                <span>
                  <span className="font-mono text-xs">{p.id}</span>{" "}
                  <span className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</span>
                </span>
                <span className="tabular-nums">
                  {formatMoney(p.applied)} <span className="text-xs text-muted-foreground">→ {formatMoney(p.after)} left</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {tooMuch && <Alert kind="warning">Amount exceeds the outstanding balance.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={submitting || amountNum <= 0 || tooMuch || (staffOptions ? !staffId : false) || target.balance <= 0}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
        Record {formatMoney(amountNum)}
      </button>
    </form>
  );
}
