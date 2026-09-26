"use client";

import { useCallback, useEffect, useState } from "react";
import { HandCoins, Loader2, Wallet2 } from "lucide-react";
import type { AuthUser, OutletDTO, PaymentDTO, StaffDTO } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, StatCard, formatDate } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import { CollectPaymentForm, type CollectPaymentTarget } from "./payment-form";

/**
 * The payments ledger. Admin sees every collection, filterable by outlet, collector and
 * date. Stock incharge only ever sees payments they personally collected (the server
 * enforces this — any filter they try to send for another staff member is ignored), so
 * their view has no "collected by" filter to begin with.
 */
export default function PaymentsView({ user, outlets, staff }: { user: AuthUser; outlets: OutletDTO[]; staff: StaffDTO[] }) {
  const isAdmin = user.role === "admin";
  const [outletId, setOutletId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [range, setRange] = useState<DateRange>({});
  const [payments, setPayments] = useState<PaymentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayments(await api.payments({ outletId: outletId || undefined, staffId: isAdmin ? staffId || undefined : undefined, ...range }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [outletId, staffId, range, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = round2((payments ?? []).reduce((s, p) => s + p.amount, 0));

  return (
    <div className="space-y-4">
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Filter by outlet">
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {isAdmin && (
            <select className="input w-auto" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Filter by who collected it">
              <option value="">Collected by anyone</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        <button className="btn btn-primary sm:w-auto" onClick={() => setCollecting(true)}>
          <HandCoins className="h-4 w-4" /> Collect Payment
        </button>
      </div>

      <StatCard label={`Total ${payments ? `(${payments.length})` : ""}`} value={formatMoney(total)} icon={Wallet2} tone="lime" />

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card overflow-hidden">
        {loading && !payments ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800">
              <thead className="bg-slate-800/60">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Outlet</th>
                  {isAdmin && <th className="th">Collected by</th>}
                  <th className="th">Method</th>
                  <th className="th">Invoice</th>
                  <th className="th">Notes</th>
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(payments ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/60">
                    <td className="td whitespace-nowrap text-slate-400">{formatDate(p.createdAt)}</td>
                    <td className="td font-medium">{p.outletName}</td>
                    {isAdmin && <td className="td">{p.staffName}</td>}
                    <td className="td">{p.paymentMethod}</td>
                    <td className="td font-mono text-xs">{p.invoiceId ?? "—"}</td>
                    <td className="td max-w-48 truncate text-slate-400">{p.notes ?? ""}</td>
                    <td className="td text-right font-semibold tabular-nums text-emerald-400">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {payments && payments.length === 0 && <EmptyState>No payments match these filters.</EmptyState>}
      </div>

      <Modal open={collecting} title="Collect payment" onClose={() => setCollecting(false)}>
        <CollectPaymentFlow
          outlets={outlets}
          staffOptions={isAdmin ? staff : undefined}
          onDone={async (message) => {
            setCollecting(false);
            setFlash(message);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

/** Outlet picker that loads that outlet's balance on selection, then hands off to the form. */
function CollectPaymentFlow({
  outlets,
  staffOptions,
  onDone,
}: {
  outlets: OutletDTO[];
  staffOptions?: StaffDTO[];
  onDone: (message: string) => Promise<void>;
}) {
  const [outletId, setOutletId] = useState("");
  const [target, setTarget] = useState<CollectPaymentTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string) {
    setOutletId(id);
    setTarget(null);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const b = await api.outletLedger(id);
      setTarget({ outletId: b.outletId, outletName: b.outletName, balance: b.balance, openInvoices: b.openInvoices });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outlet balance");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="cp-outlet">Outlet</label>
        <select id="cp-outlet" className="input" value={outletId} onChange={(e) => void pick(e.target.value)} autoFocus>
          <option value="">Select outlet…</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading balance…
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {target && target.balance <= 0 && <Alert kind="warning">This outlet has no outstanding balance.</Alert>}
      {target && target.balance > 0 && <CollectPaymentForm target={target} staffOptions={staffOptions} onDone={onDone} />}
    </div>
  );
}
