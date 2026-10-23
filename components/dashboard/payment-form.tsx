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
interface EntryRow {
  key: number;
  reference: string;
  date: string;
  amount: string;
}

/** CHEQUE, NET_BANKING and VOUCHER all collect one or more entries instead of a single flat
 * amount — labels differ per method so the form reads naturally for each. */
const ENTRY_LABELS: Partial<Record<PaymentMethod, { section: string; ref: string; placeholder: string; add: string }>> = {
  CHEQUE: { section: "Cheques", ref: "Serial no.", placeholder: "e.g. 004512", add: "Add cheque" },
  NET_BANKING: { section: "Transfers", ref: "Reference / UTR no.", placeholder: "e.g. UTR2410231234", add: "Add transfer" },
  VOUCHER: { section: "Vouchers", ref: "Voucher no.", placeholder: "e.g. V-1042", add: "Add voucher" },
};

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
  const [entries, setEntries] = useState<EntryRow[]>([{ key: 0, reference: "", date: today(), amount: String(target.balance) }]);
  const [nextKey, setNextKey] = useState(1);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryLabels = ENTRY_LABELS[method];
  const isMultiEntry = !!entryLabels;
  const entriesTotal = round2(entries.reduce((s, e) => s + (Number.parseFloat(e.amount) || 0), 0));
  const entriesValid = entries.every((e) => e.reference.trim() && e.date && (Number.parseFloat(e.amount) || 0) > 0);
  const amountNum = isMultiEntry ? entriesTotal : Number.parseFloat(amount) || 0;
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

  function updateEntry(key: number, patch: Partial<EntryRow>) {
    setEntries((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addEntry() {
    const paid = entriesTotal;
    const left = Math.max(0, round2(target.balance - paid));
    setEntries((rows) => [...rows, { key: nextKey, reference: "", date: today(), amount: left > 0 ? String(left) : "" }]);
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
        amount: isMultiEntry ? undefined : amountNum,
        paymentMethod: method,
        entries: isMultiEntry
          ? entries.map((e) => ({ reference: e.reference.trim(), date: e.date, amount: Number.parseFloat(e.amount) }))
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
        {!isMultiEntry && (
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

      {isMultiEntry && entryLabels && (
        <div className="space-y-2">
          <p className="label">{entryLabels.section}</p>
          {entries.map((e, idx) => (
            <div key={e.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-lg border border-border p-2">
              <div>
                <label className="label" htmlFor={`entry-ref-${e.key}`}>{entryLabels.ref}</label>
                <input
                  id={`entry-ref-${e.key}`}
                  className="input"
                  value={e.reference}
                  onChange={(ev) => updateEntry(e.key, { reference: ev.target.value })}
                  placeholder={entryLabels.placeholder}
                  autoFocus={idx === 0}
                />
              </div>
              <div>
                <label className="label" htmlFor={`entry-date-${e.key}`}>Date</label>
                <input
                  id={`entry-date-${e.key}`}
                  type="date"
                  className="input"
                  value={e.date}
                  onChange={(ev) => updateEntry(e.key, { date: ev.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor={`entry-amt-${e.key}`}>Amount</label>
                <input
                  id={`entry-amt-${e.key}`}
                  type="number"
                  min={0.01}
                  step="0.01"
                  className="input"
                  value={e.amount}
                  onChange={(ev) => updateEntry(e.key, { amount: ev.target.value })}
                />
              </div>
              <button
                type="button"
                className="mb-1 rounded p-1.5 text-muted-foreground hover:bg-danger hover:text-danger-foreground disabled:opacity-40"
                onClick={() => setEntries((rows) => rows.filter((r) => r.key !== e.key))}
                disabled={entries.length === 1}
                aria-label="Remove entry"
                title="Remove entry"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" className="btn btn-secondary sm:w-auto" onClick={addEntry}>
              <Plus className="h-4 w-4" /> {entryLabels.add}
            </button>
            <span className="text-sm text-muted-foreground">
              Total <span className="font-semibold tabular-nums text-foreground">{formatMoney(entriesTotal)}</span>
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
        disabled={submitting || amountNum <= 0 || tooMuch || (isMultiEntry && !entriesValid) || (staffOptions ? !staffId : false) || target.balance <= 0}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
        Record {formatMoney(amountNum)}
      </button>
    </form>
  );
}
