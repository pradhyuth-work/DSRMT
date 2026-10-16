"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Gift, IndianRupee, Loader2, PiggyBank, Tag } from "lucide-react";
import type { OutletDTO, ProductDTO, SchemeSavingsBillRow, SchemeSavingsBreakdownRow, SchemeSavingsResponse, StaffDTO } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, PAGE_SIZE, Pagination, StatCard, formatDate, usePagination } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import { Combobox } from "./Combobox";

type View = "outlet" | "product" | "agent" | "month" | "bills";

const VIEWS: { id: View; label: string }[] = [
  { id: "outlet", label: "By Outlet" },
  { id: "product", label: "By Product" },
  { id: "agent", label: "By Agent" },
  { id: "month", label: "By Month" },
  { id: "bills", label: "Bills" },
];

/**
 * Admin-only: what billing at the normal price instead of scheme saved. Modelled directly
 * on SalesReports.tsx — same filter row, StatCard row, tab switcher and table styling —
 * so it reads as part of the same site rather than a bolted-on page.
 */
export default function SchemeSavings({ outlets, products, staff }: { outlets: OutletDTO[]; products: ProductDTO[]; staff: StaffDTO[] }) {
  const agents = useMemo(() => staff.filter((s) => s.role === "agent"), [staff]);

  const [range, setRange] = useState<DateRange>({});
  const [outletId, setOutletId] = useState("");
  const [productId, setProductId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [view, setView] = useState<View>("outlet");
  const [report, setReport] = useState<SchemeSavingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedBill, setSelectedBill] = useState<SchemeSavingsBillRow | null>(null);

  const query = useMemo(
    () => ({ ...range, outletId: outletId || undefined, productId: productId || undefined, staffId: staffId || undefined }),
    [range, outletId, productId, staffId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.schemeSavings(query));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheme savings");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadCsv() {
    setDownloading(true);
    setError(null);
    try {
      await api.downloadSchemeSavingsCsv(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download CSV");
    } finally {
      setDownloading(false);
    }
  }

  const totals = report
    ? { billed: report.billed, atScheme: report.atScheme, saved: report.saved, pctSaved: report.pctSaved }
    : { billed: 0, atScheme: 0, saved: 0, pctSaved: 0 };

  const qualityNote =
    report && (report.noSchemeLines > 0 || report.estimatedLines > 0)
      ? [
          report.noSchemeLines > 0
            ? `${report.noSchemeLines} line${report.noSchemeLines === 1 ? " has" : "s have"} no scheme price set`
            : null,
          report.estimatedLines > 0
            ? `${report.estimatedLines} line${report.estimatedLines === 1 ? " uses" : "s use"} an estimated scheme price (older bills)`
            : null,
        ]
          .filter((s): s is string => s !== null)
          .join("; ") + "."
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={range} onChange={setRange} />
          <Combobox
            className="w-44"
            value={outletId}
            onChange={setOutletId}
            placeholder="All outlets"
            ariaLabel="Filter by outlet"
            options={[{ value: "", label: "All outlets" }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]}
          />
          <Combobox
            className="w-44"
            value={productId}
            onChange={setProductId}
            placeholder="All products"
            ariaLabel="Filter by product"
            options={[{ value: "", label: "All products" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Combobox
            className="w-44"
            value={staffId}
            onChange={setStaffId}
            placeholder="All field agents"
            ariaLabel="Filter by field agent"
            options={[{ value: "", label: "All field agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary sm:w-auto"
            onClick={() => void downloadCsv()}
            disabled={downloading || !report || report.bills.length === 0}
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download CSV
          </button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {qualityNote && <Alert kind="warning">{qualityNote}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Billed (no scheme)" value={report ? formatMoney(report.billed) : "—"} icon={IndianRupee} tone="teal" />
        <StatCard label="At Scheme Price" value={report ? formatMoney(report.atScheme) : "—"} icon={Tag} tone="gold" />
        <StatCard label="Saved" value={report ? formatMoney(report.saved) : "—"} icon={PiggyBank} tone="lime" />
        <StatCard label="Scheme Given" value={report ? formatMoney(report.given) : "—"} icon={Gift} tone="rose" />
      </div>

      <div className="flex gap-1 border-b border-border">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              view === v.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {loading && !report ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : !report ? null : view === "bills" ? (
        <BillsTable bills={report.bills} onSelect={setSelectedBill} />
      ) : (
        <BreakdownTable
          rows={view === "outlet" ? report.byOutlet : view === "product" ? report.byProduct : view === "agent" ? report.byAgent : report.byMonth}
          groupLabel={view === "outlet" ? "Outlet" : view === "product" ? "Product" : view === "agent" ? "Agent" : "Month"}
          totals={totals}
        />
      )}

      <Modal
        open={!!selectedBill}
        title={selectedBill ? `Bill ${selectedBill.invoiceNumber ?? "—"} — ${selectedBill.outletName}` : ""}
        onClose={() => setSelectedBill(null)}
      >
        {selectedBill && <BillDetail bill={selectedBill} />}
      </Modal>
    </div>
  );
}

function BreakdownTable({
  rows,
  groupLabel,
  totals,
}: {
  rows: SchemeSavingsBreakdownRow[];
  groupLabel: string;
  totals: { billed: number; atScheme: number; saved: number; pctSaved: number };
}) {
  const page = usePagination(rows);
  if (rows.length === 0) return <div className="card"><EmptyState>No scheme savings in this range.</EmptyState></div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-secondary">
            <tr>
              <th className="th">{groupLabel}</th>
              <th className="th text-right">Billed</th>
              <th className="th text-right">At Scheme</th>
              <th className="th text-right">Saved</th>
              <th className="th text-right">% Saved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {page.pageItems.map((r) => (
              <tr key={r.id} className="hover:bg-secondary">
                <td className="td font-medium">{r.name}</td>
                <td className="td text-right tabular-nums">{formatMoney(r.billed)}</td>
                <td className="td text-right tabular-nums text-muted-foreground">{formatMoney(r.atScheme)}</td>
                <td className="td text-right font-semibold tabular-nums text-success-foreground">{formatMoney(r.saved)}</td>
                <td className="td text-right tabular-nums text-muted-foreground">{r.pctSaved}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-secondary font-semibold">
              <td className="td">Total</td>
              <td className="td text-right tabular-nums">{formatMoney(totals.billed)}</td>
              <td className="td text-right tabular-nums">{formatMoney(totals.atScheme)}</td>
              <td className="td text-right tabular-nums text-success-foreground">{formatMoney(totals.saved)}</td>
              <td className="td text-right tabular-nums">{totals.pctSaved}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
    </div>
  );
}

function BillsTable({ bills, onSelect }: { bills: SchemeSavingsBillRow[]; onSelect: (b: SchemeSavingsBillRow) => void }) {
  const page = usePagination(bills);
  if (bills.length === 0) return <div className="card"><EmptyState>No scheme savings in this range.</EmptyState></div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-secondary">
            <tr>
              <th className="th">Bill #</th>
              <th className="th">Outlet</th>
              <th className="th">Agent</th>
              <th className="th">Billed Date</th>
              <th className="th text-right">Billed</th>
              <th className="th text-right">At Scheme</th>
              <th className="th text-right">Saved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {page.pageItems.map((b) => (
              <tr
                key={b.invoiceId}
                className="cursor-pointer hover:bg-secondary"
                onClick={() => onSelect(b)}
                title="View line-by-line scheme price"
              >
                <td className="td font-mono text-xs">{b.invoiceNumber ?? "—"}</td>
                <td className="td font-medium">{b.outletName}</td>
                <td className="td text-muted-foreground">{b.agentName}</td>
                <td className="td text-muted-foreground">{formatDate(b.billedAt)}</td>
                <td className="td text-right tabular-nums">{formatMoney(b.billedAmount)}</td>
                <td className="td text-right tabular-nums text-muted-foreground">{formatMoney(b.atScheme)}</td>
                <td className="td text-right font-semibold tabular-nums text-success-foreground">{formatMoney(b.saved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
    </div>
  );
}

function BillDetail({ bill }: { bill: SchemeSavingsBillRow }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{formatDate(bill.billedAt)}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="th">Product</th>
              <th className="th text-right">Qty</th>
              <th className="th text-right">Billed Price</th>
              <th className="th text-right">Scheme Price</th>
              <th className="th text-right">Saved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bill.items.map((i) => (
              <tr key={i.productId}>
                <td className="td">{i.productName}</td>
                <td className="td text-right tabular-nums">{i.quantity}</td>
                <td className="td text-right tabular-nums">{formatMoney(i.unitPrice)}</td>
                <td className="td text-right tabular-nums">
                  {i.schemeUnitPrice != null ? formatMoney(i.schemeUnitPrice) : <span className="text-muted-foreground">—</span>}
                  {i.schemeEstimated && <span className="ml-1 text-[10px] text-muted-foreground">(est.)</span>}
                </td>
                <td className="td text-right font-semibold tabular-nums text-success-foreground">{formatMoney(i.saved)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-secondary font-semibold">
              <td className="td" colSpan={4}>Total saved</td>
              <td className="td text-right tabular-nums text-success-foreground">{formatMoney(bill.saved)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
