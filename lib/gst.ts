import { round2 } from "@/lib/money";

export type TaxMode = "MRP" | "INCLUSIVE" | "EXCLUSIVE";
export const TAX_MODES: readonly TaxMode[] = ["MRP", "INCLUSIVE", "EXCLUSIVE"];
export const HOME_STATE = "29";

export interface LineTax {
  /** What the customer pays for the line, tax included. */
  gross: number;
  /** Value on which tax is charged / reported (in MRP mode: MRP-based, not the billed price). */
  taxable: number;
  tax: number;
}

/**
 * Tax for one line under the three options.
 *  EXCLUSIVE: price is before tax, tax is added on top.
 *  INCLUSIVE: price already has tax, tax is taken out of it.
 *  MRP: price has tax; tax is worked on the MRP (Rule 31D, the MTR way): tax = MRP x qty x rate/(100+rate).
 * Returns null for MRP when no MRP is known, since the tax can't be worked out.
 */
/**
 * GST tax on a taxable value, always an even number of paise: the e-invoice portal rejects a bill whose
 * SGST and CGST differ by even a paisa (error 2227), so tax = 2 x the rounded half.
 */
export function evenTax(taxable: number, rate: number): number {
  return round2(2 * round2((taxable * rate) / 200));
}

export function computeLine(mode: TaxMode, price: number, qty: number, rate: number, mrp: number | null): LineTax | null {
  if (mode === "EXCLUSIVE") {
    const taxable = round2(price * qty);
    const tax = evenTax(taxable, rate);
    return { gross: round2(taxable + tax), taxable, tax };
  }
  const gross = round2(price * qty);
  if (mode === "INCLUSIVE") {
    const taxable = round2((gross * 100) / (100 + rate));
    return { gross, taxable, tax: evenTax(taxable, rate) };
  }
  if (!mrp || mrp <= 0) return null;
  // MRP (RSP-based) valuation: tax is charged on the MRP, so taxable = MRP x qty x 100/(100+rate) and
  // tax = rate% of that. The customer still pays the billed price (gross); the gap between taxable + tax
  // and gross is the trade discount, shown on the invoice as a deduction.
  const mrpValue = mrp * qty;
  const taxable = round2((mrpValue * 100) / (100 + rate));
  return { gross, taxable, tax: evenTax(taxable, rate) };
}

/** Intra-state supplies split tax into CGST + SGST, everything else is IGST. */
export function splitTax(tax: number, placeOfSupply: string): { cgst: number; sgst: number; igst: number } {
  if (placeOfSupply === HOME_STATE) {
    const half = round2(tax / 2);
    return { cgst: half, sgst: round2(tax - half), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: tax };
}

/** Indian state / UT codes, for the POS place-of-supply picker. */
export const STATES: { code: string; name: string }[] = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
  ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"],
  ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra & Nagar Haveli and Daman & Diu"],
  ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"],
  ["34", "Puducherry"], ["35", "Andaman & Nicobar"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
].map(([code, name]) => ({ code, name }));

/**
 * Place of supply = where the goods are delivered. Normally the state in the buyer's GSTIN, but a buyer
 * registered in another state (e.g. a Delhi GSTIN) that takes delivery in Karnataka is a Karnataka supply.
 * Karnataka pincodes start with 56 (and 57-59), so a delivery pincode there overrides the GSTIN state.
 */
export function supplyState(gstin: string | null | undefined, pincode: string | null | undefined): string {
  const pin = (pincode ?? "").trim();
  if (/^5[6-9][0-9]{4}$/.test(pin)) return HOME_STATE;
  const g = (gstin ?? "").trim();
  return /^[0-9]{2}/.test(g) ? g.slice(0, 2) : HOME_STATE;
}
