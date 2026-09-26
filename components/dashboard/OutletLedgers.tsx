"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, HandCoins, Loader2 } from "lucide-react";
import type { OutletLedger, PaymentMethod } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import type { DashboardData } from "./Dashboard";

export default function OutletLedgers({ data, onSaved }: { data: DashboardData; onSaved: () => Promise<void> }) {
  const ledgers = data.reports.outletLedgers;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<OutletLedger | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const closeModal = useCallback(() => setCollecting(null), []);

  return (
    <div className="space-y-4">
      {flash && <Alert kind="success">{flash}</Alert>}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th w-8" />
                <th className="th">Outlet</th>
                <th className="th text-right">Total Billed</th>
                <th className="th text-right">Total Paid</th>
                <th className="th text-right">Balance</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ledgers.map((l) => {
                const isOpen = expanded === l.outletId;
                return (
                  <Fragment key={l.outletId}>
                    <tr className="hover:bg-slate-50">
                      <td className="td">
                        <button
                          onClick={() => setExpanded(isOpen ? null : l.outletId)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200"
                          aria-label={isOpen ? "Hide ledger" : "Show ledger"}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="td">
                        <p className="font-medium">{l.outletName}</p>
                        <p className="text-xs text-slate-500">
                          {l.phone} · {l.openInvoices.length} open invoice{l.openInvoices.length === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="td text-right tabular-nums">{formatMoney(l.totalBilled)}</td>
                      <td className="td text-right tabular-nums text-emerald-700">{formatMoney(l.totalPaid)}</td>
                      <td className={`td text-right font-semibold tabular-nums ${l.balance > 0 ? "text-amber-700" : "text-slate-500"}`}>
                        {formatMoney(l.balance)}
                      </td>
                      <td className="td text-right">
                        <button
                          className="btn btn-primary px-3 py-1.5"
                          disabled={l.balance <= 0}
                          onClick={() => {
                            setFlash(null);
                            setCollecting(l);
                          }}
                        >
                          <HandCoins className="h-4 w-4" />
                          <span className="hidden md:inline">Collect Payment</span>
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-4 py-3">
                          <LedgerTable ledger={l} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {ledgers.length === 0 && <EmptyState>No outlets yet.</EmptyState>}
      </div>

      <Modal open={!!collecting} title={`Collect payment — ${collecting?.outletName ?? ""}`} onClose={closeModal}>
        {collecting && (
          <CollectPaymentForm
            key={collecting.outletId}
            ledger={collecting}
            data={data}
            onDone={async (message) => {
              setCollecting(null);
              setFlash(message);
              await onSaved();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function LedgerTable({ ledger }: { ledger: OutletLedger }) {
  if (ledger.entries.length === 0) return <EmptyState>No transactions for this outlet yet.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead>
          <tr>
            <th className="th">Date</th>
            <th className="th">Ref</th>
            <th className="th">Description</th>
            <th className="th text-right">Debit</th>
            <th className="th text-right">Credit</th>
            <th className="th text-right">Running Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {ledger.entries.map((e, i) => (
            <tr key={`${e.reference}-${e.type}-${i}`}>
              <td className="td whitespace-nowrap text-slate-500">{formatDate(e.date)}</td>
              <td className="td font-mono text-xs">{e.reference}</td>
              <td className="td">{e.description}</td>
              <td className="td text-right tabular-nums">{e.debit ? formatMoney(e.debit) : ""}</td>
              <td className="td text-right tabular-nums text-emerald-700">{e.credit ? formatMoney(e.credit) : ""}</td>
              <td className="td text-right font-medium tabular-nums">{formatMoney(e.runningBalance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CollectPaymentForm({
  ledger,
  data,
  onDone,
}: {
  ledger: OutletLedger;
  data: DashboardData;
  onDone: (message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(ledger.balance));
  const [staffId, setStaffId] = useState(data.staff[0]?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number.parseFloat(amount) || 0;
  const tooMuch = amountNum > ledger.balance;

  // Preview how the payment will be applied, oldest invoice first (mirrors the server's FIFO logic).
  const preview = useMemo(() => {
    let remaining = round2(amountNum);
    return ledger.openInvoices.map((inv) => {
      const applied = round2(Math.max(0, Math.min(remaining, inv.balanceDue)));
      remaining = round2(remaining - applied);
      return { ...inv, applied, after: round2(inv.balanceDue - applied) };
    });
  }, [amountNum, ledger.openInvoices]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createPayment({
        outletId: ledger.outletId,
        staffId,
        amount: amountNum,
        paymentMethod: method,
        notes: notes.trim() || undefined,
      });
      await onDone(
        `Collected ${formatMoney(res.amount)} from ${ledger.outletName} — applied to ${res.allocations
          .map((a) => a.invoiceId)
          .join(", ")}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
        <span className="text-amber-800">Outstanding balance</span>
        <span className="font-semibold tabular-nums text-amber-800">{formatMoney(ledger.balance)}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pay-amount">Amount</label>
          <input
            id="pay-amount"
            type="number"
            min={0.01}
            step="0.01"
            max={ledger.balance}
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="pay-staff">Collected by</label>
          <select id="pay-staff" className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
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
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {preview.map((p) => (
            <li key={p.id} className={`flex items-center justify-between px-3 py-2 ${p.applied > 0 ? "" : "text-slate-400"}`}>
              <span>
                <span className="font-mono text-xs">{p.id}</span>{" "}
                <span className="text-xs text-slate-400">{formatDate(p.createdAt)}</span>
              </span>
              <span className="tabular-nums">
                {formatMoney(p.applied)} <span className="text-xs text-slate-400">→ {formatMoney(p.after)} left</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {tooMuch && <Alert kind="warning">Amount exceeds the outstanding balance.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <button type="submit" className="btn btn-primary w-full" disabled={submitting || amountNum <= 0 || tooMuch || !staffId}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
        Record {formatMoney(amountNum)}
      </button>
    </form>
  );
}
