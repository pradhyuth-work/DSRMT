import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";
import { SELLER } from "@/lib/seller";
import { computeLine, STATES } from "@/lib/gst";
import { einvoiceInclude } from "@/lib/einvoice";
import { gspTestMode } from "@/lib/gstin-client";
import { irpDocNumber } from "@/lib/invoice-series";
import { qrFromGsp } from "@/lib/qr";

export const round2n = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const f2 = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
export const ist = (d: Date, withTime: boolean) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("day")}-${g("month")}-${g("year")}${withTime ? ` ${g("hour")}:${g("minute")}` : ""}`;
};

/**
 * The IRN block to print for a bill, if it has an active IRN for its present number. A live one always wins;
 * a test one shows only while the app is in test mode, and is labelled as not valid.
 */
async function loadIrnBlock(invoiceId: string, invoiceNumber: string) {
  // Printing must keep working even if the e-invoice table has not been created yet.
  const rows = await prisma.eInvoice
    .findMany({ where: { invoiceId, docNo: irpDocNumber(invoiceNumber), irn: { not: null }, status: { in: ["GENERATED", "CANCELLING"] } } })
    .catch(() => []);
  const r = rows.find((x) => !x.testMode) ?? (gspTestMode() ? rows.find((x) => x.testMode) : undefined);
  if (!r) return null;
  const ewb = r.ewbStatus === "GENERATED" && r.ewbNo ? { no: r.ewbNo, date: r.ewbDate ?? "", validUpto: r.ewbValidUpto ?? "" } : null;
  return { test: r.testMode, irn: r.irn!, ackNo: r.ackNo ?? "", ackDate: r.ackDate ?? "", qr: qrFromGsp(r.qrImage), ewb };
}

/** Everything the printed / PDF invoice shows, worked out once. Throws if the order has no in-app GST invoice. */
export async function loadInvoiceView(id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { ...einvoiceInclude, staff: true } });
  if (!inv) throw new HttpError(404, "Order not found");
  if (!inv.invoiceNumber || inv.billedOutside) throw new HttpError(409, "No GST invoice for this order (billed outside the app or not billed yet)");
  const invoiceNumber = inv.invoiceNumber;
  const o = inv.outlet;
  const pos = inv.placeOfSupply || "29";
  const intra = pos === SELLER.stateCode;
  const stateName = STATES.find((x) => x.code === pos)?.name ?? "";
  // Same layout as the Target bill: line Amount = what the buyer pays for the line less its tax (no discount
  // column — any scheme is already in the rate); the GST summary's SALE VAL is the MRP-based taxable value.
  const rows = inv.items.map((it, i) => {
    const rate = it.gstRate ?? it.product.gstRate;
    const mrp = it.mrp ?? it.product.mrp ?? 0;
    const calc = it.taxable != null && it.taxAmt != null ? { taxable: it.taxable, tax: it.taxAmt } : (() => { const c = computeLine("MRP", it.unitPrice, it.quantity, rate, mrp); return { taxable: c?.taxable ?? it.subtotal, tax: c?.tax ?? 0 }; })();
    const pk = /(\d+)\s*s\b/i.exec(it.product.name)?.[1] ?? "";
    const amt = round2n(calc.taxable);
    return { n: i + 1, name: it.product.name, hsn: it.hsnCode ?? it.product.hsnCode ?? "", pk, mrp, qty: it.quantity, rate: amt / it.quantity, taxable: calc.taxable, tax: calc.tax, amt, gst: rate };
  });
  const saleVal = rows.reduce((s, r) => s + r.taxable, 0);
  const sumTax = rows.reduce((s, r) => s + r.tax, 0);
  const subTotal = rows.reduce((s, r) => s + r.amt, 0);
  const sumQty = rows.reduce((s, r) => s + r.qty, 0);
  const mrpValue = rows.reduce((s, r) => s + r.mrp * r.qty, 0);
  const net = inv.totalAmount;
  // Lines and SALE VAL are on MRP; what the buyer pays is lower, and the gap (scheme / trade margin) is one
  // deduction before the net amount. The e-invoice JSON carries the same gap as ValDtls.Discount.
  const discount = inv.taxMode === "MRP" && subTotal + sumTax - net > 0.005 ? round2n(subTotal + sumTax - net) : 0;
  const round = round2n(net - (subTotal + sumTax - discount));
  const rate0 = rows[0]?.gst ?? 40;
  const addr = [o.address, [o.city, o.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const when = inv.billedAt ?? inv.createdAt;
  const ship = inv.shipToAddress ? { name: inv.shipToName || o.name, addr: [inv.shipToAddress, [inv.shipToCity, inv.shipToPincode].filter(Boolean).join(" ")].filter(Boolean).join(", "), different: true } : { name: o.name, addr, different: false };
  // One summary row per GST rate (a bill can mix 40% cigarettes with 5% / 18% items).
  const slabMap = new Map<number, { rate: number; saleVal: number; tax: number }>();
  for (const r of rows) {
    const x = slabMap.get(r.gst) ?? { rate: r.gst, saleVal: 0, tax: 0 };
    x.saleVal += r.taxable; x.tax += r.tax;
    slabMap.set(r.gst, x);
  }
  const slabs = [...slabMap.values()].sort((a, b) => b.rate - a.rate).map((x) => ({ ...x, saleVal: round2n(x.saleVal), tax: round2n(x.tax), half: round2n(x.tax / 2) }));
  const half = round2n(slabs.reduce((s, x) => s + x.half, 0));
  const einv = await loadIrnBlock(inv.id, invoiceNumber);
  return { einv, inv, invoiceNumber, o, pos, intra, stateName, rows, saleVal, sumTax, subTotal, sumQty, mrpValue, net, discount, round, rate0, slabs, addr, ship, when, half };
}
