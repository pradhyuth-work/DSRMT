import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { SELLER } from "@/lib/seller";
import { computeLine, STATES } from "@/lib/gst";
import { einvoiceInclude } from "@/lib/einvoice";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round2n = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const f2 = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
const ist = (d: Date, withTime: boolean) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("day")}-${g("month")}-${g("year")}${withTime ? ` ${g("hour")}:${g("minute")}` : ""}`;
};

/**
 * Printable A5 tax invoice (HTML) for a bill made in the app. The client fetches it with the
 * bearer token and opens it in a new window to print or save as PDF.
 * Bills written outside the app have no GST invoice, so there is nothing to print for them.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin", "stock"]);
    const { id } = await params;
    const inv = await prisma.invoice.findUnique({ where: { id }, include: { ...einvoiceInclude, staff: true } });
    if (!inv) throw new HttpError(404, "Order not found");
    if (!inv.invoiceNumber || inv.billedOutside) throw new HttpError(409, "No GST invoice for this order (billed outside the app or not billed yet)");

    const o = inv.outlet;
    const pos = inv.placeOfSupply || "29";
    const intra = pos === SELLER.stateCode;
    const stateName = STATES.find((x) => x.code === pos)?.name ?? "";
    const rows = inv.items.map((it, i) => {
      const rate = it.gstRate ?? it.product.gstRate;
      const mrp = it.mrp ?? it.product.mrp ?? 0;
      const calc = it.taxable != null && it.taxAmt != null ? { taxable: it.taxable, tax: it.taxAmt } : (() => { const c = computeLine("MRP", it.unitPrice, it.quantity, rate, mrp); return { taxable: c?.taxable ?? it.subtotal, tax: c?.tax ?? 0 }; })();
      const pk = /(\d+)\s*s\b/i.exec(it.product.name)?.[1] ?? "";
      return { n: i + 1, name: it.product.name, hsn: it.hsnCode ?? it.product.hsnCode ?? "", pk, mrp, qty: it.quantity, rate: it.unitPrice, taxable: calc.taxable, tax: calc.tax, amt: round2n(calc.taxable + calc.tax), gst: rate };
    });
    const sumTaxable = rows.reduce((s, r) => s + r.taxable, 0);
    const sumTax = rows.reduce((s, r) => s + r.tax, 0);
    const sumAmt = rows.reduce((s, r) => s + r.amt, 0);
    const sumQty = rows.reduce((s, r) => s + r.qty, 0);
    const mrpValue = rows.reduce((s, r) => s + r.mrp * r.qty, 0);
    const net = inv.totalAmount;
    // MRP mode: lines add up to the MRP value; the gap to what the buyer pays is the trade discount.
    const discount = inv.taxMode === "MRP" && sumAmt - net > 0 ? round2n(sumAmt - net) : 0;
    const round = round2n(net - (sumAmt - discount));
    const rate0 = rows[0]?.gst ?? 40;
    const addr = [o.address, [o.city, o.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const when = inv.billedAt ?? inv.createdAt;
    const grid = "16px 112px 48px 24px 32px 30px 24px 36px 54px 48px 1fr";
    const taxHead = intra
      ? `<div>SGST %</div><div>SGST AMT</div><div>CGST %</div><div>CGST AMT</div>`
      : `<div>IGST %</div><div>IGST AMT</div><div></div><div></div>`;
    const taxVals = intra
      ? `<div>${rate0 / 2}</div><div>${f2(sumTax / 2)}</div><div>${rate0 / 2}</div><div>${f2(sumTax / 2)}</div>`
      : `<div>${rate0}</div><div>${f2(sumTax)}</div><div></div><div></div>`;

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(inv.invoiceNumber)}</title>
<style>
@page{size:A5 portrait;margin:0}
*{box-sizing:border-box}body{margin:0;background:#fff;color:#1B2B2A;font-family:Barlow,Segoe UI,Arial,sans-serif;font-size:9px;line-height:1.35}
.page{width:148mm;height:210mm;padding:20px 22px 16px;display:flex;flex-direction:column;overflow:hidden}
.lbl{font-size:7px;letter-spacing:.1em;color:#5A6D6C}.row{display:grid;grid-template-columns:${grid};gap:2px}
@media screen{body{background:#e8e8e8;display:flex;justify-content:center;padding:16px}.page{background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.2)}}
</style></head><body><div class="page">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:9px;border-bottom:2px solid #0F2B2A">
<div style="display:flex;gap:10px;align-items:center;min-width:0">
<img src="/varasidhi-logo.png" style="width:52px;height:52px;border-radius:12px;flex:0 0 auto" alt="">
<div><div style="font-weight:700;font-size:20px;letter-spacing:.07em;line-height:1;color:#0F2B2A">VARASIDHI ENTERPRISES</div>
<div style="font-size:8px;margin-top:4px;color:#3C4F4E">${esc(SELLER.addr1)}, ${esc(SELLER.addr2)},<br>${esc(SELLER.location)} ${SELLER.pincode}</div>
<div style="font-size:8.5px;margin-top:3px">GSTIN: <b>${SELLER.gstin}</b></div></div></div>
<div style="text-align:right"><div style="font-weight:700;font-size:15px;letter-spacing:.2em;color:#0F2B2A">TAX INVOICE</div>
<div style="font-size:7.5px;letter-spacing:.12em;color:#5A6D6C;margin-top:3px">ORIGINAL FOR RECIPIENT</div></div></div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #C9D3D2">
<div style="padding:6px 8px 6px 0"><div class="lbl">INVOICE NO</div><div style="font-weight:700;font-size:13px">${esc(inv.invoiceNumber)}</div></div>
<div style="padding:6px 8px"><div class="lbl">INVOICE DATE</div><div style="font-weight:700;font-size:11px">${ist(when, false)}</div></div>
<div style="padding:6px 8px"><div class="lbl">PLACE OF SUPPLY</div><div style="font-weight:600;font-size:10px">${esc(pos)}${stateName ? ` - ${esc(stateName)}` : ""}</div></div></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #C9D3D2">
<div style="padding:5px 8px 5px 0"><div class="lbl">VEHICLE NO</div><div style="font-weight:600">${esc(inv.vehicleNo ?? "")}&nbsp;</div></div>
<div style="padding:5px 8px"><div class="lbl">DATE &amp; TIME OF SUPPLY</div><div style="font-weight:600">${ist(when, true)}</div></div>
<div style="padding:5px 8px"><div class="lbl">REVERSE CHARGE</div><div style="font-weight:600">No</div></div>
<div style="padding:5px 0 5px 8px"><div class="lbl">REP</div><div style="font-weight:600">${esc(inv.staff?.name ?? "")}</div></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:8px 0;border-bottom:1px solid #C9D3D2">
${["BILLED TO", "SHIPPED TO"].map((t) => `<div><div class="lbl" style="letter-spacing:.14em;margin-bottom:2px">${t}</div><div style="font-weight:700;font-size:10.5px">${esc(o.name)}</div><div style="font-size:8.5px">${esc(addr)}</div>${o.gstNumber ? `<div style="font-size:8.5px;margin-top:2px">GSTIN: <b>${esc(o.gstNumber)}</b></div>` : ""}</div>`).join("")}</div>
<div class="row" style="margin-top:8px;padding:5px 0;border-top:1.5px solid #0F2B2A;border-bottom:1.5px solid #0F2B2A;font-weight:700;font-size:7px;letter-spacing:.06em">
<div>#</div><div>DESCRIPTION</div><div>HSN</div><div style="text-align:right">PKNG</div><div style="text-align:right">M.R.P</div><div style="text-align:right">QTY</div><div style="text-align:right">FREE</div><div style="text-align:right">RATE</div><div style="text-align:right">TAXABLE</div><div style="text-align:right">GST ${rate0}%</div><div style="text-align:right">AMOUNT</div></div>
<div style="flex:1;min-height:0;font-size:8.5px">
${rows.map((r) => `<div class="row" style="padding:4px 0;border-bottom:1px solid #E3E9E8"><div style="color:#5A6D6C">${r.n}</div><div style="font-weight:600">${esc(r.name)}</div><div>${esc(r.hsn)}</div><div style="text-align:right">${r.pk}</div><div style="text-align:right">${f2(r.mrp)}</div><div style="text-align:right">${r.qty}</div><div style="text-align:right">0</div><div style="text-align:right">${f2(r.rate)}</div><div style="text-align:right">${f2(r.taxable)}</div><div style="text-align:right">${f2(r.tax)}</div><div style="text-align:right;font-weight:700">${f2(r.amt)}</div></div>`).join("")}
<div class="row" style="padding:6px 0 1px;font-weight:700"><div></div><div style="grid-column:span 4;text-align:right">GROSS TAXABLE VALUE</div><div style="text-align:right">${sumQty}</div><div></div><div></div><div style="text-align:right">${f2(sumTaxable)}</div><div></div><div></div></div>
${discount > 0 ? `<div class="row" style="padding:1px 0"><div></div><div style="grid-column:span 4;text-align:right">LESS: TRADE DISCOUNT</div><div></div><div></div><div></div><div></div><div></div><div style="text-align:right">-${f2(discount)}</div></div>` : ""}
<div class="row" style="padding:1px 0"><div></div><div style="grid-column:span 4;text-align:right">ROUND OFF</div><div></div><div></div><div></div><div style="text-align:right">${f2(round)}</div><div></div><div></div></div></div>
<div style="display:grid;grid-template-columns:1.25fr 1fr;gap:14px;border-top:1.5px solid #0F2B2A;padding-top:8px">
<div style="font-size:8px">
<div style="display:grid;grid-template-columns:.7fr 1.3fr .7fr 1fr .7fr 1fr;gap:2px;font-weight:700;font-size:7px;color:#5A6D6C;padding-bottom:2px;border-bottom:1px solid #C9D3D2"><div>GST %</div><div>TAX AMT</div>${taxHead}</div>
<div style="display:grid;grid-template-columns:.7fr 1.3fr .7fr 1fr .7fr 1fr;gap:2px;padding-top:2px"><div>${rate0}.0</div><div>${f2(sumTax)}</div>${taxVals}</div>
<div style="margin-top:7px">MRP value: <b>${f2(mrpValue)}</b></div>
<div class="lbl" style="margin-top:7px">TERMS</div><div>Goods once sold will not be returned.</div></div>
<div style="display:flex;flex-direction:column;justify-content:space-between">
<div style="border:1.5px solid #0F2B2A;padding:6px 10px;display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:8px;letter-spacing:.12em;font-weight:700">NET AMOUNT</span><span style="font-weight:700;font-size:20px">₹ ${f2(net)}</span></div>
<div style="text-align:right;margin-top:24px"><div style="font-weight:700;font-size:8.5px">For VARASIDHI ENTERPRISES</div><div style="border-top:1px solid #8A9B9A;margin-top:18px;padding-top:2px;font-size:7px;letter-spacing:.1em;color:#5A6D6C">AUTHORISED SIGNATORY</div></div></div></div>
</div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
