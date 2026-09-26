"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Download, IndianRupee, Loader2, Wallet } from "lucide-react";
import type { OutletDTO, SalesReportResponse } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, StatCard } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import { Combobox } from "./Combobox";

type View = "product" | "outlet" | "sku";

const VIEWS: { id: View; label: string }[] = [
  { id: "product", label: "By Product" },
  { id: "outlet", label: "By Outlet" },
  { id: "sku", label: "SKU Matrix" },
];

/** Quotes a CSV field only when it needs it — keeps plain numbers and names readable. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((r) => r.map(csvField).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Admin sales reports: date + outlet filtered, with the same three breakdowns as the
 * reference DSR site — by product, by outlet, and an outlet × product SKU matrix.
 */
export default function SalesReports({ outlets }: { outlets: OutletDTO[] }) {
  const [range, setRange] = useState<DateRange>({});
  const [outletId, setOutletId] = useState("");
  const [view, setView] = useState<View>("product");
  const [report, setReport] = useState<SalesReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.salesReport({ ...range, outletId: outletId || undefined }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [range, outletId]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportCsv() {
    if (!report) return;
    if (view === "product") {
      downloadCsv(
        "sales-by-product.csv",
        ["Product", "Unit Price", "Orders", "Qty Sold", "Revenue", "% of Total"],
        report.byProduct.map((p) => [p.productName, p.unitPrice, p.orders, p.qtySold, p.revenue, p.pctOfTotal]),
      );
    } else if (view === "outlet") {
      downloadCsv(
        "sales-by-outlet.csv",
        ["Outlet", "Orders", "Gross Sales", "Payments Received", "Balance"],
        report.byOutlet.map((o) => [o.outletName, o.orders, o.grossSales, o.paymentsReceived, o.balance]),
      );
    } else {
      const { outlets: rowOutlets, products: colProducts, cells } = report.skuMatrix;
      downloadCsv(
        "sku-matrix.csv",
        ["Outlet", ...colProducts.map((p) => p.name), "Total"],
        rowOutlets.map((o, i) => [o.name, ...cells[i], o.total]),
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={range} onChange={setRange} />
          <Combobox
            className="w-48"
            value={outletId}
            onChange={setOutletId}
            placeholder="All outlets"
            ariaLabel="Filter by outlet"
            options={[{ value: "", label: "All outlets" }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </div>
        <button className="btn btn-secondary sm:w-auto" onClick={exportCsv} disabled={!report}>
          <Download className="h-4 w-4" /> Download CSV
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Orders" value={report ? String(report.ordersCount) : "—"} icon={ClipboardList} tone="teal" />
        <StatCard label="Total Sales" value={report ? formatMoney(report.totalSales) : "—"} icon={IndianRupee} tone="lime" />
        <StatCard label="Payments Received" value={report ? formatMoney(report.totalPayments) : "—"} icon={Wallet} tone="gold" />
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
      ) : !report ? null : view === "product" ? (
        <ByProductTable rows={report.byProduct} />
      ) : view === "outlet" ? (
        <ByOutletTable rows={report.byOutlet} />
      ) : (
        <SkuMatrixTable matrix={report.skuMatrix} />
      )}
    </div>
  );
}

function ByProductTable({ rows }: { rows: SalesReportResponse["byProduct"] }) {
  if (rows.length === 0) return <div className="card"><EmptyState>No sales in this range.</EmptyState></div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-secondary">
            <tr>
              <th className="th">Product</th>
              <th className="th text-right">Unit Price</th>
              <th className="th text-right">Orders</th>
              <th className="th text-right">Qty Sold</th>
              <th className="th text-right">Revenue</th>
              <th className="th text-right">% of Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.productId} className="hover:bg-secondary">
                <td className="td font-medium">{p.productName}</td>
                <td className="td text-right tabular-nums">{formatMoney(p.unitPrice)}</td>
                <td className="td text-right tabular-nums">{p.orders}</td>
                <td className="td text-right tabular-nums">{p.qtySold.toLocaleString("en-IN")}</td>
                <td className="td text-right font-semibold tabular-nums">{formatMoney(p.revenue)}</td>
                <td className="td text-right tabular-nums text-muted-foreground">{p.pctOfTotal}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByOutletTable({ rows }: { rows: SalesReportResponse["byOutlet"] }) {
  if (rows.length === 0) return <div className="card"><EmptyState>No sales in this range.</EmptyState></div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-secondary">
            <tr>
              <th className="th">Outlet</th>
              <th className="th text-right">Orders</th>
              <th className="th text-right">Gross Sales</th>
              <th className="th text-right">Payments Received</th>
              <th className="th text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((o) => (
              <tr key={o.outletId} className="hover:bg-secondary">
                <td className="td font-medium">{o.outletName}</td>
                <td className="td text-right tabular-nums">{o.orders}</td>
                <td className="td text-right font-semibold tabular-nums">{formatMoney(o.grossSales)}</td>
                <td className="td text-right tabular-nums text-success-foreground">{formatMoney(o.paymentsReceived)}</td>
                <td className={`td text-right tabular-nums ${o.balance > 0 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                  {formatMoney(o.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkuMatrixTable({ matrix }: { matrix: SalesReportResponse["skuMatrix"] }) {
  if (matrix.outlets.length === 0 || matrix.products.length === 0) {
    return <div className="card"><EmptyState>No sales in this range.</EmptyState></div>;
  }
  const columnTotals = matrix.products.map((_, pi) => matrix.outlets.reduce((s, _o, oi) => s + matrix.cells[oi][pi], 0));
  return (
    <div className="card overflow-hidden">
      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="sticky top-0 z-10 bg-secondary">
            <tr>
              <th className="th sticky left-0 z-20 bg-secondary">Outlet</th>
              {matrix.products.map((p) => (
                <th key={p.id} className="th whitespace-nowrap text-right">{p.name}</th>
              ))}
              <th className="th text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {matrix.outlets.map((o, oi) => (
              <tr key={o.id} className="hover:bg-secondary">
                <td className="td sticky left-0 z-10 bg-card font-medium">{o.name}</td>
                {matrix.products.map((p, pi) => {
                  const qty = matrix.cells[oi][pi];
                  return (
                    <td key={p.id} className={`td text-right tabular-nums ${qty === 0 ? "text-muted-foreground/40" : ""}`}>
                      {qty || "—"}
                    </td>
                  );
                })}
                <td className="td text-right font-semibold tabular-nums">{o.total.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-secondary font-semibold">
              <td className="td sticky left-0 z-10 bg-secondary">Total</td>
              {columnTotals.map((t, i) => (
                <td key={matrix.products[i].id} className="td text-right tabular-nums">{t.toLocaleString("en-IN")}</td>
              ))}
              <td className="td text-right tabular-nums">
                {matrix.outlets.reduce((s, o) => s + o.total, 0).toLocaleString("en-IN")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
