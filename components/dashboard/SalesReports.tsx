"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Download, FileSpreadsheet, HardDriveDownload, IndianRupee, Loader2, Wallet } from "lucide-react";
import type { OutletDTO, ProductDTO, SalesReportResponse } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, DaysOutstandingBadge, EmptyState, PAGE_SIZE, Pagination, StatCard, usePagination } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import { Combobox } from "./Combobox";

type View = "product" | "outlet" | "sku" | "inventory";

const VIEWS: { id: View; label: string }[] = [
  { id: "product", label: "By Product" },
  { id: "outlet", label: "By Outlet" },
  { id: "sku", label: "SKU Matrix" },
  { id: "inventory", label: "Live Inventory" },
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
export default function SalesReports({ outlets, products }: { outlets: OutletDTO[]; products: ProductDTO[] }) {
  const [range, setRange] = useState<DateRange>({});
  const [outletId, setOutletId] = useState("");
  const [view, setView] = useState<View>("product");
  const [report, setReport] = useState<SalesReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);

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

  async function downloadBackup() {
    setBackingUp(true);
    setError(null);
    try {
      await api.downloadBackup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download backup");
    } finally {
      setBackingUp(false);
    }
  }

  async function downloadReportCsv() {
    setDownloadingReport(true);
    setError(null);
    try {
      await api.downloadSalesReportCsv({ ...range, outletId: outletId || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download report");
    } finally {
      setDownloadingReport(false);
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
        <div className="flex gap-2">
          <button className="btn btn-secondary sm:w-auto" onClick={() => void downloadBackup()} disabled={backingUp} title="Download every table as one JSON file">
            {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
            Full backup
          </button>
          <button className="btn btn-secondary sm:w-auto" onClick={exportCsv} disabled={!report}>
            <Download className="h-4 w-4" /> Download CSV
          </button>
          <button
            className="btn btn-secondary sm:w-auto"
            onClick={() => void downloadReportCsv()}
            disabled={downloadingReport}
            title="By-product and by-outlet breakdowns, generated server-side for this exact filter"
          >
            {downloadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Report CSV
          </button>
        </div>
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

      {view === "inventory" ? (
        <LiveInventoryTable products={products} />
      ) : loading && !report ? (
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
  const page = usePagination(rows);
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
            {page.pageItems.map((p) => (
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
      <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
    </div>
  );
}

function ByOutletTable({ rows }: { rows: SalesReportResponse["byOutlet"] }) {
  const page = usePagination(rows);
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
              <th className="th text-right">Days of Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {page.pageItems.map((o) => (
              <tr key={o.outletId} className="hover:bg-secondary">
                <td className="td font-medium">{o.outletName}</td>
                <td className="td text-right tabular-nums">{o.orders}</td>
                <td className="td text-right font-semibold tabular-nums">{formatMoney(o.grossSales)}</td>
                <td className="td text-right tabular-nums text-success-foreground">{formatMoney(o.paymentsReceived)}</td>
                <td className={`td text-right tabular-nums ${o.balance > 0 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                  {formatMoney(o.balance)}
                </td>
                <td className="td text-right">
                  {o.oldestInvoiceDays !== null ? <DaysOutstandingBadge days={o.oldestInvoiceDays} /> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
    </div>
  );
}

const LOW_STOCK_THRESHOLD = 10;

/** Every product's current stock and price, as of right now — a straight read from
 * Product, not a date-ranged report. Outlets in this model never carry their own stock
 * (warehouse → dispatched in one step), unlike the reference app's route buyers, so
 * there's no "stock at outlet" breakdown here — this is the whole picture. */
function LiveInventoryTable({ products }: { products: ProductDTO[] }) {
  const page = usePagination(products);
  if (products.length === 0) return <div className="card"><EmptyState>No products yet.</EmptyState></div>;
  const totalUnits = products.reduce((s, p) => s + (p.stockQty ?? 0), 0);
  const totalValue = products.reduce((s, p) => s + (p.stockQty ?? 0) * p.unitPrice, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 text-sm text-muted-foreground">
        <span>{products.length} products</span>
        <span>
          {totalUnits.toLocaleString("en-IN")} units on hand · {formatMoney(totalValue)} at current rates
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-secondary">
            <tr>
              <th className="th">#</th>
              <th className="th">Product</th>
              <th className="th text-right">Unit Price</th>
              <th className="th text-right">In Stock</th>
              <th className="th text-right">Stock Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {page.pageItems.map((p) => {
              const qty = p.stockQty ?? 0;
              const style =
                qty === 0 ? "bg-danger text-danger-foreground" : qty < LOW_STOCK_THRESHOLD ? "bg-warning text-warning-foreground" : "bg-success text-success-foreground";
              return (
                <tr key={p.id} className="hover:bg-secondary">
                  <td className="td text-muted-foreground">#{p.productCode}</td>
                  <td className="td font-medium">{p.name}</td>
                  <td className="td text-right tabular-nums">{formatMoney(p.unitPrice)}</td>
                  <td className="td text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${style}`}>{qty}</span>
                  </td>
                  <td className="td text-right tabular-nums">{formatMoney(qty * p.unitPrice)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
    </div>
  );
}

function SkuMatrixTable({ matrix }: { matrix: SalesReportResponse["skuMatrix"] }) {
  // Pair each outlet with its original row index so paginated rows can still look up the
  // right column in matrix.cells; column totals are summed over every outlet, not just the
  // visible page.
  const indexedOutlets = useMemo(() => matrix.outlets.map((o, oi) => ({ ...o, oi })), [matrix.outlets]);
  const page = usePagination(indexedOutlets);
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
            {page.pageItems.map((o) => (
              <tr key={o.id} className="hover:bg-secondary">
                <td className="td sticky left-0 z-10 bg-card font-medium">{o.name}</td>
                {matrix.products.map((p, pi) => {
                  const qty = matrix.cells[o.oi][pi];
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
      <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
    </div>
  );
}
