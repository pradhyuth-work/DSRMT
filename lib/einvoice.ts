import type { Prisma } from "@prisma/client";
import { SELLER } from "@/lib/seller";
import { irpDocNumber } from "@/lib/invoice-series";
import { round2 } from "@/lib/money";
import { computeLine, splitTax, type TaxMode } from "@/lib/gst";

/** What the e-invoice builder needs from the database. */
export const einvoiceInclude = {
  outlet: true,
  items: { include: { product: true }, orderBy: { id: "asc" } },
} satisfies Prisma.InvoiceInclude;

export type EinvoiceSource = Prisma.InvoiceGetPayload<{ include: typeof einvoiceInclude }>;

export interface EinvoiceResult {
  invoiceNumber: string;
  /** The IRP schema 1.1 document; null when something required is missing (see `errors`). */
  json: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EWB_THRESHOLD = 50_000;

const r3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** DD/MM/YYYY in India time — the format the IRP wants. */
function irpDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("day")}/${g("month")}/${g("year")}`;
}

/**
 * Builds one e-invoice (IRP schema 1.1) from a bill made in the app.
 *
 * Valuation follows Rule 31D (RSP-based) for notified tobacco: tax = MRP x qty x rate/(100+rate),
 * taxable value = billed amount - tax. Billed prices are GST-inclusive. Because the tax rests on
 * MRP and not on the taxable value, tax is not exactly rate% of taxable value — the IRP's tax
 * cross-check may flag it, which is why the first live test (sandbox) matters. All of it is in
 * this one function so it can be switched if the CA/IRP wants a different treatment.
 */
export function buildEinvoice(inv: EinvoiceSource): EinvoiceResult {
  const number = inv.invoiceNumber ?? "(no number)";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!inv.invoiceNumber) errors.push("No invoice number");
  if (inv.billedOutside) errors.push("Billed outside the app — no e-invoice is made");
  if (inv.fulfilmentStatus === "CANCELLED") errors.push("Cancelled");
  if (!inv.billedAt) errors.push("Not billed yet");

  const o = inv.outlet;
  const gstin = (o.gstNumber ?? "").trim().toUpperCase();
  if (!gstin) errors.push("Outlet has no GSTIN (B2C) — e-invoice not applicable");
  else if (!GSTIN_RE.test(gstin)) errors.push(`Outlet GSTIN "${gstin}" is not a valid GSTIN`);
  if (!/^[0-9]{6}$/.test((o.pincode ?? "").trim())) errors.push(`Outlet "${o.name}": add a 6-digit pincode`);
  if (clip(o.city ?? "", 50).length < 3) errors.push(`Outlet "${o.name}": add the city`);
  if (clip(o.address ?? "", 100).length < 1) errors.push(`Outlet "${o.name}": add the address`);

  const mode = (inv.taxMode as TaxMode) ?? "MRP";
  const missingProducts = new Set<string>();
  for (const it of inv.items) {
    const p = it.product;
    const hsn = (it.hsnCode ?? p.hsnCode ?? "").trim();
    if (!/^[0-9]{4,8}$/.test(hsn)) missingProducts.add(`${p.name} (HSN)`);
    const hasSnapshot = it.taxable != null && it.taxAmt != null;
    if (!hasSnapshot && mode === "MRP" && !(it.mrp ?? p.mrp)) missingProducts.add(`${p.name} (MRP)`);
  }
  if (missingProducts.size > 0) errors.push(`Product set-up missing: ${[...missingProducts].join(", ")}`);
  if (inv.items.length === 0) errors.push("No items");
  if (errors.length > 0) return { invoiceNumber: number, json: null, errors, warnings };

  const buyerState = gstin.slice(0, 2);
  const intra = buyerState === SELLER.stateCode;
  let assTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;

  const items = inv.items.map((it, i) => {
    const p = it.product;
    const rate = it.gstRate ?? p.gstRate;
    const t =
      it.taxable != null && it.taxAmt != null
        ? { gross: round2(it.taxable + it.taxAmt), taxable: it.taxable, tax: it.taxAmt }
        : computeLine(mode, it.unitPrice, it.quantity, rate, it.mrp ?? p.mrp)!;
    const ass = t.taxable;
    const sp = splitTax(t.tax, intra ? "29" : buyerState);
    assTotal += ass; cgstTotal += sp.cgst; sgstTotal += sp.sgst; igstTotal += sp.igst;
    const mrp = it.mrp ?? p.mrp;
    if (mode === "MRP" && mrp && it.unitPrice > mrp) warnings.push(`${p.name}: billed price ${it.unitPrice} is above MRP ${mrp}`);
    return {
      SlNo: String(i + 1),
      PrdDesc: clip(p.name, 300).padEnd(3, " "),
      IsServc: "N",
      HsnCd: (it.hsnCode ?? p.hsnCode)!.trim(),
      Qty: it.quantity,
      FreeQty: 0,
      Unit: p.uqc || "NOS",
      UnitPrice: r3(ass / it.quantity),
      TotAmt: ass,
      Discount: 0,
      AssAmt: ass,
      GstRt: rate,
      IgstAmt: sp.igst,
      CgstAmt: sp.cgst,
      SgstAmt: sp.sgst,
      CesRt: 0,
      CesAmt: 0,
      TotItemVal: round2(ass + sp.cgst + sp.sgst + sp.igst),
    };
  });

  // The billed total is the figure customers pay; any paisa difference goes in round-off.
  const billed = inv.totalAmount;
  const sumItems = round2(items.reduce((s, x) => s + x.TotItemVal, 0));
  const roundOff = round2(billed - sumItems);
  if (Math.abs(roundOff) > 1) warnings.push(`Billed total ${billed} differs from the item total ${sumItems} by more than ₹1`);
  if (mode === "MRP") warnings.push("Tax is worked on MRP (Rule 31D), so it is not exactly 40% of the taxable value — confirm the IRP accepts it in the sandbox");

  const veh = (inv.vehicleNo ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const needsEwb = billed > EWB_THRESHOLD;
  const doc: Record<string, unknown> = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: irpDocNumber(inv.invoiceNumber!), Dt: irpDate(inv.billedAt!) },
    SellerDtls: {
      Gstin: SELLER.gstin,
      LglNm: SELLER.legalName,
      Addr1: SELLER.addr1,
      Addr2: SELLER.addr2,
      Loc: SELLER.location,
      Pin: SELLER.pincode,
      Stcd: SELLER.stateCode,
    },
    BuyerDtls: {
      Gstin: gstin,
      LglNm: clip(o.name, 100),
      Pos: buyerState,
      Addr1: clip(o.address, 100),
      Loc: clip(o.city ?? "", 50),
      Pin: Number.parseInt(o.pincode!.trim(), 10),
      Stcd: buyerState,
    },
    ItemList: items,
    ValDtls: {
      AssVal: round2(assTotal),
      CgstVal: round2(cgstTotal),
      SgstVal: round2(sgstTotal),
      IgstVal: round2(igstTotal),
      CesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: roundOff,
      TotInvVal: round2(sumItems + roundOff),
    },
  };

  if (needsEwb) {
    if (veh.length >= 7) {
      // Distance 0 lets the portal work out the distance from the two pincodes.
      doc.EwbDtls = { Distance: 0, VehNo: veh, VehType: "R", TransMode: "1" };
    } else {
      warnings.push(`Over ₹${EWB_THRESHOLD.toLocaleString("en-IN")}: an e-way bill is needed but no vehicle number is set, so none is included`);
    }
  }
  return { invoiceNumber: number, json: doc, errors: [], warnings };
}
