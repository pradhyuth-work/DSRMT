"use client";

import { useMemo, useState } from "react";
import { HandCoins, Loader2, Plus, Trash2 } from "lucide-react";
import type { AuthUser, PaymentMethod, StaffDTO } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, DaysOutstandingBadge, PaymentMethodPicker, formatDate } from "./ui";
import { Combobox } from "./Combobox";

export interface CollectPaymentTarget {
  outletId: string;
  outletName: string;
  balance: number;
  /** Oldest first — the order a payment settles them in. */
  openInvoices: { id: string; invoiceNumber: string | null; balanceDue: number; createdAt: string; daysOutstanding: number }[];
}

/**
 * The actual collection form, reused wherever a payment gets recorded against an outlet:
 * from a specific ledger row (already know the balance) or from the standalone Payments
 * tab (balance fetched on outlet selection). "Received by" defaults to whoever is signed in.
 * Only admins and managers (stock incharge) can receive payments, so field agents are never
 * offered. When `staffOptions` is omitted the payment is always attributed to the signed-in
 * user — the server enforces this regardless of what the client sends.
 */
interface ChequeRow {
  key: number;
  serialNumber: string;
  date: string;
  amount: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CollectPaymentForm({
  target,
  user,
  staffOptions,
  onDone,
}: {
  target: CollectPaymentTarget;
  user: AuthUser;
  staffOptions?: StaffDTO[];
  onDone: (message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(target.balance));
  const receivers = useMemo(() => (staffOptions ?? []).filter((s) => s.role !== "agent"), [staffOptions]);
  const [staffId, setStaffId] = useState(user.id);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cheques, setCheques] = useState<ChequeRow[]>([{ key: 0, serialNumber: "", date: today(), amount: String(target.balance) }]);
  const [nextKey, setNextKey] = useState(1);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCheque = method === "CHEQUE";
  const chequesTotal = round2(cheques.reduce((s, c) => s + (Number.parseFloat(c.amount) || 0), 0));
  const chequesValid = cheques.every((c) => c.serialNumber.trim() && c.date && (Number.parseFloat(c.amount) || 0) > 0);
  const amountNum = isCheque ? chequesTotal : Number.parseFloat(amount) || 0;
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

  function updateCheque(key: number, patch: Partial<ChequeRow>) {
    setCheques((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addCheque() {
    const paid = chequesTotal;
    const left = Math.max(0, round2(target.balance - paid));
    setCheques((rows) => [...rows, { key: nextKey, serialNumber: "", date: today(), amount: left > 0 ? String(left) : "" }]);
    setNextKey((k) => k + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createPayment({
        outletId: target.outletId,
        staffId: staffOptions ? staffId : undefined,
        amount: isCheque ? undefined : amountNum,
        paymentMethod: method,
        cheques: isCheque
          ? cheques.map((c) => ({ serialNumber: c.serialNumber.trim(), date: c.date, amount: Number.parseFloat(c.amount) }))
          : undefined,
        notes: notes.trim() || undefined,
      });
      await onDone(
        `Collected ${formatMoney(res.amount)} from ${target.outletName} — applied to ${res.allocations
          .map((a) => (a.invoiceNumber ? `Bill #${a.invoiceNumber}` : "an unbilled order"))
          .join(", ")}`,
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
          <label className="label" htmlFor="pay-staff">Received by</label>
          {staffOptions ? (
            <Combobox
              id="pay-staff"
              value={staffId}
              onChange={setStaffId}
              options={receivers.map((s) => ({ value: s.id, label: s.id === user.id ? `${s.name} (you)` : s.name }))}
            />
          ) : (
            <input id="pay-staff" className="input" value={user.name} readOnly disabled />
          )}
        </div>
        <div>
          <span className="label">Method</span>
          <PaymentMethodPicker value={method} onChange={setMethod} />
        </div>
        {!isCheque && (
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
        )}
        <div>
          <label className="label" htmlFor="pay-notes">Notes</label>
          <input id="pay-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      {isCheque && (
        <div className="space-y-2">
          <p className="label">Cheques</p>
          {cheques.map((c, idx) => (
            <div key={c.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-lg border border-border p-2">
              <div>
                <label className="label" htmlFor={`chq-no-${c.key}`}>Serial no.</label>
                <input
                  id={`chq-no-${c.key}`}
                  className="input"
                  value={c.serialNumber}
                  onChange={(e) => updateCheque(c.key, { serialNumber: e.target.value })}
                  placeholder="e.g. 004512"
                  autoFocus={idx === 0}
                />
              </div>
              <div>
                <label className="label" htmlFor={`chq-date-${c.key}`}>Date</label>
                <input
                  id={`chq-date-${c.key}`}
                  type="date"
                  className="input"
                  value={c.date}
                  onChange={(e) => updateCheque(c.key, { date: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor={`chq-amt-${c.key}`}>Amount</label>
                <input
                  id={`chq-amt-${c.key}`}
                  type="number"
                  min={0.01}
                  step="0.01"
                  className="input"
                  value={c.amount}
                  onChange={(e) => updateCheque(c.key, { amount: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="mb-1 rounded p-1.5 text-muted-foreground hover:bg-danger hover:text-danger-foreground disabled:opacity-40"
                onClick={() => setCheques((rows) => rows.filter((r) => r.key !== c.key))}
                disabled={cheques.length === 1}
                aria-label="Remove cheque"
                title="Remove cheque"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" className="btn btn-secondary sm:w-auto" onClick={addCheque}>
              <Plus className="h-4 w-4" /> Add cheque
            </button>
            <span className="text-sm text-muted-foreground">
              Total <span className="font-semibold tabular-nums text-foreground">{formatMoney(chequesTotal)}</span>
            </span>
          </div>
        </div>
      )}

      <div>
        <p className="label">Settlement preview (oldest first)</p>
        {target.openInvoices.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">No outstanding invoices.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {preview.map((p) => (
              <li key={p.id} className={`flex items-center justify-between px-3 py-2 ${p.applied > 0 ? "" : "text-muted-foreground"}`}>
                <span>
                  <span className="font-mono text-xs">{p.invoiceNumber ?? "Unbilled"}</span>{" "}
                  <span className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</span>{" "}
                  <span className="text-xs">
                    (<DaysOutstandingBadge days={p.daysOutstanding} />)
                  </span>
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
        disabled={submitting || amountNum <= 0 || tooMuch || (isCheque && !chequesValid) || (staffOptions ? !staffId : false) || target.balance <= 0}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
        Record {formatMoney(amountNum)}
      </button>
    </form>
  );
}
