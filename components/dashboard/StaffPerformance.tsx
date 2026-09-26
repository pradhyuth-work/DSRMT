"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, ClipboardList, Loader2, Smartphone, UserRound } from "lucide-react";
import type { StaffPerformance } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";

/** Sales figures are dated by the order; collections by the payment — so filtering to a
 * range shows what was sold and what was collected IN that window, not a snapshot as-of. */
export default function StaffPerformanceView() {
  const [range, setRange] = useState<DateRange>({});
  const [rows, setRows] = useState<StaffPerformance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: DateRange) => {
    try {
      setRows((await api.reports(r)).staffPerformance);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staff performance");
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const maxSales = Math.max(...(rows ?? []).map((r) => r.totalSales), 1);

  return (
    <div className="space-y-6">
      <DateRangeFilter value={range} onChange={setRange} />
      {error && <Alert kind="error">{error}</Alert>}

      {!rows ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState>No staff members yet.</EmptyState></div>
      ) : (
        <>
      <div className="grid gap-4 md:grid-cols-3">
        {rows.map((r) => {
          const collectionRate = r.totalSales > 0 ? Math.round((1 - r.uncollectedBalance / r.totalSales) * 100) : 0;
          return (
            <div key={r.staffId} className="card space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-blue-500/15 p-2 text-blue-400">
                  <UserRound className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">{r.staffName}</p>
                  <p className="text-xs text-slate-400">{r.phone}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric icon={ClipboardList} label="Orders" value={String(r.totalOrders)} />
                <Metric icon={ClipboardList} label="Sales value" value={formatMoney(r.totalSales)} />
                <Metric icon={Banknote} label="Cash collected" value={formatMoney(r.cashCollected)} />
                <Metric icon={Smartphone} label="UPI collected" value={formatMoney(r.upiCollected)} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-400">
                  <span>Settled on own invoices</span>
                  <span>{r.totalSales > 0 ? `${collectionRate}%` : "—"}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${collectionRate}%` }} />
                </div>
                <p className="mt-2 text-xs">
                  Uncollected: <span className="font-semibold text-amber-400">{formatMoney(r.uncollectedBalance)}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead className="bg-slate-800/60">
              <tr>
                <th className="th">Staff</th>
                <th className="th text-right">Orders</th>
                <th className="th">Sales Value</th>
                <th className="th text-right">Cash</th>
                <th className="th text-right">UPI</th>
                <th className="th text-right">Total Collected</th>
                <th className="th text-right">Uncollected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <tr key={r.staffId} className="hover:bg-slate-800/60">
                  <td className="td font-medium">{r.staffName}</td>
                  <td className="td text-right tabular-nums">{r.totalOrders}</td>
                  <td className="td min-w-48">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${(r.totalSales / maxSales) * 100}%` }} />
                      </div>
                      <span className="w-28 text-right tabular-nums">{formatMoney(r.totalSales)}</span>
                    </div>
                  </td>
                  <td className="td text-right tabular-nums">{formatMoney(r.cashCollected)}</td>
                  <td className="td text-right tabular-nums">{formatMoney(r.upiCollected)}</td>
                  <td className="td text-right font-semibold tabular-nums text-emerald-400">{formatMoney(r.totalCollected)}</td>
                  <td className="td text-right tabular-nums text-amber-400">{formatMoney(r.uncollectedBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Sales are dated by the order; collections by the payment. Uncollected is the remaining balance (as of now) on
        orders placed in this range.
      </p>
        </>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Banknote; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/60 p-2.5">
      <p className="flex items-center gap-1 text-xs text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="truncate font-semibold tabular-nums">{value}</p>
    </div>
  );
}
