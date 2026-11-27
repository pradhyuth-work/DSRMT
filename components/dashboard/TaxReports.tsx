"use client";

import { useState } from "react";
import { BookOpen, Download, Eye, FileCheck, FileSpreadsheet, FileX, Hash, ReceiptText, Loader2, type LucideIcon } from "lucide-react";
import type { TaxReportTable } from "@/lib/types";
import { api } from "./api-client";
import { Alert, Modal } from "./ui";
import { CardMark, PageHead } from "./billing-ui";

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);

const REPORTS: { type: string; name: string; desc: string; download: string; view?: boolean }[] = [
  { type: "gstr1", name: "GSTR-1", desc: "B2B, B2C, HSN table and document summary, as an Excel workbook with one sheet each.", download: "Download workbook", view: true },
  { type: "gstr3b", name: "GSTR-3B", desc: "Outward tax totals for the return, ready to tie to your books.", download: "Download CSV", view: true },
  { type: "sales-register", name: "Sales register", desc: "Every invoice line with the tax break-up, in CSV.", download: "Download CSV" },
  { type: "hsn", name: "HSN summary", desc: "Quantity and value by HSN.", download: "Download CSV", view: true },
  { type: "einvoice-status", name: "E-invoice status", desc: "Every invoice with whether its JSON was made. IRN and ack no. fill in once the GSP is connected.", download: "Download CSV", view: true },
  { type: "cancelled", name: "Cancelled invoices", desc: "Every cancel with who, when and why, plus numbers reused.", download: "Download CSV", view: true },
];

const ICONS: Record<string, LucideIcon> = { gstr1: FileSpreadsheet, gstr3b: BookOpen, "sales-register": ReceiptText, hsn: Hash, "einvoice-status": FileCheck, cancelled: FileX };

/** Reports for the CA or the portal, for the invoices made in this app (MTR series), month by month. */
export default function TaxReports() {
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<{ title: string; tables: TaxReportTable[] } | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); }
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <PageHead title="Tax reports" sub="Ready for your CA or the portal. Pick the month.">
        <div className="w-full sm:w-56"><label className="label" htmlFor="tax-month">Month</label><input id="tax-month" type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      </PageHead>
      <p className="text-xs text-muted-foreground">Only invoices made in this app are included. Bills written in Target or the bill book are reported from there.</p>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r, i) => (
          <div key={r.type} className="card flex flex-col gap-3 p-6">
            <CardMark step={i + 1} icon={ICONS[r.type] ?? FileSpreadsheet} />
            <h3 className="mt-2 text-xl font-semibold">{r.name}</h3>
            <div className="flex-1 text-sm text-muted-foreground">{r.desc}</div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-primary h-10 flex-1 !px-2 text-sm" disabled={!month || busy !== null} onClick={() => void run(`${r.type}-d`, async () => { await api.taxReportDownload(r.type, month); })}>
                {busy === `${r.type}-d` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {r.download}
              </button>
              {r.view && (
                <button type="button" className="btn btn-secondary h-10 !px-3 text-sm" disabled={!month || busy !== null} onClick={() => void run(`${r.type}-v`, async () => { const res = await api.taxReportView(r.type, month); setView({ title: `${r.name} — ${month}`, tables: res.tables }); })}>
                  {busy === `${r.type}-v` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} View
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!view} title={view?.title ?? ""} onClose={() => setView(null)}>
        {view && (
          <div className="space-y-4">
            {view.tables.map((t) => (
              <div key={t.name} className="space-y-1">
                <div className="text-sm font-semibold">{t.name}</div>
                {t.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing this month.</p> : (
                  <div className="overflow-x-auto"><table className="w-full min-w-max text-xs">
                    <thead><tr>{t.header.map((h) => <th key={h} className="border-b border-border px-2 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
                    <tbody>{t.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="border-b border-border/50 px-2 py-1">{c ?? ""}</td>)}</tr>)}</tbody>
                  </table></div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
