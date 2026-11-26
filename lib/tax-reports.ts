import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";
import { round2 } from "@/lib/money";
import { computeLine, splitTax, HOME_STATE, type TaxMode } from "@/lib/gst";
import { irpDocNumber } from "@/lib/invoice-series";

export const REPORT_TYPES = ["gstr1", "gstr3b", "sales-register", "hsn", "einvoice-status", "cancelled"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const include = { outlet: true, items: { include: { product: true }, orderBy: { id: "asc" } } } satisfies Prisma.InvoiceInclude;
export type TaxInvoice = Prisma.InvoiceGetPayload<{ include: typeof include }>;

const IST = "Asia/Kolkata";
export const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
export const istDisplay = (d: Date) => istDay(d).split("-").reverse().join("-");

/** Start (inclusive) and end (exclusive) of a "YYYY-MM" month in India time. */
export function monthRange(month: string): { gte: Date; lt: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Month must be YYYY-MM");
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { gte: new Date(`${month}-01T00:00:00+05:30`), lt: new Date(`${next}-01T00:00:00+05:30`) };
}

/** Invoices made in the app in the month (cancelled ones are listed apart; they are not reported as sales). */
export async function loadMonth(month: string): Promise<{ live: TaxInvoice[]; cancelled: TaxInvoice[] }> {
  const { gte, lt } = monthRange(month);
  const rows = await prisma.invoice.findMany({
    where: { billedOutside: false, invoiceNumber: { not: null }, billedAt: { gte, lt } },
    include,
    orderBy: { billedAt: "asc" },
  });
  const cancelled = await prisma.invoice.findMany({
    where: { billedOutside: false, fulfilmentStatus: "CANCELLED", invoiceNumber: { not: null }, cancelledAt: { gte, lt } },
    include,
  });
  return { live: rows.filter((r) => r.fulfilmentStatus !== "CANCELLED"), cancelled };
}

export interface Line {
  inv: TaxInvoice;
  name: string;
  hsn: string;
  uqc: string;
  qty: number;
  mrp: number | null;
  price: number;
  rate: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  pos: string;
  gstin: string;
}

/** Per-line figures: the snapshot taken at billing, or worked out now for a line that has none. */
export function linesOf(invoices: TaxInvoice[]): { lines: Line[]; incomplete: string[] } {
  const lines: Line[] = [];
  const incomplete: string[] = [];
  for (const inv of invoices) {
    const gstin = (inv.outlet.gstNumber ?? "").trim().toUpperCase();
    const pos = /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : inv.placeOfSupply;
    for (const it of inv.items) {
      const rate = it.gstRate ?? it.product.gstRate;
      const t =
        it.taxable != null && it.taxAmt != null
          ? { taxable: it.taxable, tax: it.taxAmt }
          : computeLine(inv.taxMode as TaxMode, it.unitPrice, it.quantity, rate, it.mrp ?? it.product.mrp);
      if (!t) {
        incomplete.push(`${inv.invoiceNumber}: ${it.product.name} has no MRP`);
        continue;
      }
      const sp = splitTax(t.tax, pos);
      lines.push({
        inv, name: it.product.name, hsn: (it.hsnCode ?? it.product.hsnCode ?? "").trim(), uqc: it.product.uqc, qty: it.quantity,
        mrp: it.mrp ?? it.product.mrp, price: it.unitPrice, rate, taxable: t.taxable, tax: t.tax, ...sp, total: round2(t.taxable + t.tax), pos, gstin,
      });
    }
  }
  return { lines, incomplete };
}

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
type Row = (string | number | null)[];
export interface Table { name: string; header: string[]; rows: Row[] }

const group = <T,>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

export function gstr1Tables(live: TaxInvoice[], cancelled: TaxInvoice[]): { tables: Table[]; notes: string[] } {
  const { lines, incomplete } = linesOf(live);
  const b2b = lines.filter((l) => l.gstin);
  const b2c = lines.filter((l) => !l.gstin);

  const b2bRows: Row[] = [];
  for (const [, ls] of group(b2b, (l) => `${l.inv.id}|${l.rate}`)) {
    const l0 = ls[0];
    b2bRows.push([l0.gstin, l0.inv.outlet.name, irpDocNumber(l0.inv.invoiceNumber!), istDisplay(l0.inv.billedAt!), l0.inv.totalAmount, l0.pos, l0.rate, sum(ls.map((l) => l.taxable)), sum(ls.map((l) => l.igst)), sum(ls.map((l) => l.cgst)), sum(ls.map((l) => l.sgst))]);
  }
  const b2csRows: Row[] = [];
  for (const [, ls] of group(b2c, (l) => `${l.pos}|${l.rate}`)) {
    b2csRows.push([ls[0].pos === HOME_STATE ? "Intra-State" : "Inter-State", ls[0].pos, ls[0].rate, sum(ls.map((l) => l.taxable)), sum(ls.map((l) => l.igst)), sum(ls.map((l) => l.cgst)), sum(ls.map((l) => l.sgst))]);
  }
  const hsnRows: Row[] = [];
  for (const [, ls] of group(lines, (l) => `${l.hsn}|${l.rate}|${l.uqc}`)) {
    hsnRows.push([ls[0].hsn, ls[0].uqc, sum(ls.map((l) => l.qty)), sum(ls.map((l) => l.total)), sum(ls.map((l) => l.taxable)), ls[0].rate, sum(ls.map((l) => l.igst)), sum(ls.map((l) => l.cgst)), sum(ls.map((l) => l.sgst))]);
  }
  const nums = live.map((i) => i.invoiceNumber!).concat(cancelled.map((i) => i.invoiceNumber!).filter(Boolean));
  const docRows: Row[] = nums.length ? [["Invoices for outward supply", nums[0], nums[nums.length - 1], nums.length, cancelled.length]] : [];

  const notes = [
    "Covers invoices made in this app (MTR series) only. Bills written in Target or the bill book are reported from there.",
    "Credit notes: none are issued by the app yet. Invoices cancelled before an IRN are removed, not reported as credit notes.",
    "HSN is as entered per product. If your return needs 6-digit HSN, edit the product's HSN code.",
    ...incomplete.map((x) => `Left out (no tax data): ${x}`),
  ];
  return {
    tables: [
      { name: "B2B", header: ["GSTIN", "Receiver", "Invoice no", "Date", "Invoice value", "Place of supply", "Rate %", "Taxable value", "IGST", "CGST", "SGST"], rows: b2bRows },
      { name: "B2CS", header: ["Supply type", "Place of supply", "Rate %", "Taxable value", "IGST", "CGST", "SGST"], rows: b2csRows },
      { name: "HSN", header: ["HSN", "UQC", "Quantity", "Total value", "Taxable value", "Rate %", "IGST", "CGST", "SGST"], rows: hsnRows },
      { name: "Docs issued", header: ["Nature of document", "From", "To", "Total number", "Cancelled"], rows: docRows },
      { name: "Notes", header: ["Note"], rows: notes.map((n) => [n]) },
    ],
    notes,
  };
}

export function gstr3bTable(live: TaxInvoice[]): Table {
  const { lines, incomplete } = linesOf(live);
  return {
    name: "GSTR-3B 3.1",
    header: ["Nature of supply", "Taxable value", "IGST", "CGST", "SGST", "Cess"],
    rows: [
      ["(a) Outward taxable supplies (other than zero rated, nil rated, exempt)", sum(lines.map((l) => l.taxable)), sum(lines.map((l) => l.igst)), sum(lines.map((l) => l.cgst)), sum(lines.map((l) => l.sgst)), 0],
      ...incomplete.map((x): Row => [`Left out (no tax data): ${x}`, null, null, null, null, null]),
    ],
  };
}

export function salesRegisterTable(live: TaxInvoice[]): Table {
  const { lines, incomplete } = linesOf(live);
  return {
    name: "Sales register",
    header: ["Date", "Invoice no", "Outlet", "GSTIN", "Place of supply", "Type", "Tax option", "HSN", "Item", "Qty", "MRP", "Rate", "Taxable", "CGST", "SGST", "IGST", "Line total", "Invoice total"],
    rows: [
      ...lines.map((l): Row => [istDisplay(l.inv.billedAt!), l.inv.invoiceNumber, l.inv.outlet.name, l.gstin || "", l.pos, l.inv.posBill ? "POS" : "Order", l.inv.taxMode, l.hsn, l.name, l.qty, l.mrp, l.price, l.taxable, l.cgst, l.sgst, l.igst, l.total, l.inv.totalAmount]),
      ...incomplete.map((x): Row => [`Left out (no tax data): ${x}`]),
    ],
  };
}

export function hsnTable(live: TaxInvoice[]): Table {
  return gstr1Tables(live, []).tables.find((t) => t.name === "HSN")!;
}

/** Live IRN records only: test filings never appear in tax reports. */
export async function einvoiceStatusTable(live: TaxInvoice[]): Promise<Table> {
  const records = await prisma.eInvoice.findMany({ where: { invoiceId: { in: live.map((i) => i.id) }, testMode: false } });
  const byBill = new Map(records.map((r) => [`${r.invoiceId}|${r.docNo}`, r]));
  const STATUS: Record<string, string> = { GENERATED: "IRN generated", CANCELLED: "IRN cancelled", FAILED: "Refused by the portal", UNKNOWN: "No clear reply: check", SENDING: "Being sent", CANCELLING: "Being cancelled" };
  return {
    name: "E-invoice status",
    header: ["Invoice no", "Date", "Outlet", "GSTIN", "Type", "JSON exported", "IRN", "Ack no", "E-way bill", "Status"],
    rows: live.map((i): Row => {
      const gstin = (i.outlet.gstNumber ?? "").trim();
      const r = byBill.get(`${i.id}|${irpDocNumber(i.invoiceNumber!)}`);
      const status = r ? STATUS[r.status] ?? r.status : gstin ? (i.einvExportedAt ? "JSON made, IRN not recorded" : "Not filed") : "B2C: no e-invoice needed";
      return [i.invoiceNumber, istDisplay(i.billedAt!), i.outlet.name, gstin, gstin ? "B2B" : "B2C", i.einvExportedAt ? istDisplay(i.einvExportedAt) : "", r?.irn ?? "", r?.ackNo ?? "", r?.ewbNo ?? "", status];
    }),
  };
}

interface AuditRow { at: string; by: string; invoiceNumber: string; action: string; reason: string; numberReused: boolean }
export async function cancelledTable(month: string): Promise<Table> {
  const { gte, lt } = monthRange(month);
  const row = await prisma.appSetting.findUnique({ where: { key: "invoice_audit" } });
  let list: AuditRow[] = [];
  try { const p: unknown = JSON.parse(row?.value ?? "[]"); if (Array.isArray(p)) list = p as AuditRow[]; } catch { list = []; }
  return {
    name: "Cancelled invoices",
    header: ["When", "By", "Invoice no", "Action", "Reason", "Number reused"],
    rows: list.filter((a) => { const d = new Date(a.at); return d >= gte && d < lt; }).map((a): Row => [`${istDisplay(new Date(a.at))} ${new Date(a.at).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" })}`, a.by, a.invoiceNumber, a.action === "CANCEL" ? "Cancelled" : "Returned to Pending", a.reason, a.numberReused ? "Yes" : "No"]),
  };
}
