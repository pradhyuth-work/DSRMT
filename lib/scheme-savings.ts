import { prisma } from "./prisma";
import { round2 } from "./money";
import type { FulfilmentStatus, SchemeSavingsBillLine, SchemeSavingsBillRow, SchemeSavingsBreakdownRow, SchemeSavingsResponse } from "./types";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar month a UTC instant falls on in India time — "2026-01" to group/sort by, "Jan
 * 2026" to show. Shifting the instant by the IST offset and then reading it back with UTC
 * getters (and formatting with timeZone: "UTC") sidesteps the host machine's own timezone. */
function istMonth(d: Date): { key: string; label: string } {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const key = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = ist.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return { key, label };
}

interface AggRow {
  name: string;
  billed: number;
  saved: number;
}

function bump(map: Map<string, AggRow>, id: string, name: string, billedDelta: number, savedDelta: number) {
  const row = map.get(id) ?? { name, billed: 0, saved: 0 };
  row.billed = round2(row.billed + billedDelta);
  row.saved = round2(row.saved + savedDelta);
  map.set(id, row);
}

function toBreakdownRows(map: Map<string, AggRow>): SchemeSavingsBreakdownRow[] {
  return [...map.entries()]
    .map(([id, r]) => ({
      id,
      name: r.name,
      billed: r.billed,
      atScheme: round2(r.billed - r.saved),
      saved: r.saved,
      pctSaved: r.billed > 0 ? round2((r.saved / r.billed) * 100) : 0,
    }))
    .sort((a, b) => b.saved - a.saved);
}

/** The already-billed/dispatched-or-not shape `computeSchemeSavings` works from — plain data
 * so it can be unit-tested with fixtures, without a database. */
export interface SchemeSavingsInvoiceInput {
  id: string;
  invoiceNumber: string | null;
  billedAt: Date | null;
  fulfilmentStatus: FulfilmentStatus;
  hasScheme: boolean;
  outletId: string;
  outletName: string;
  staffId: string;
  staffName: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    schemeUnitPrice: number | null;
    schemeEstimated: boolean;
  }[];
}

const COUNTED_STATUSES: readonly FulfilmentStatus[] = ["BILLED", "DISPATCHED"];

/**
 * Pure calculation, modelled on buildSalesReport's shape but line-item based throughout
 * (billed/atScheme/saved all derive from InvoiceItem.subtotal, not Invoice.totalAmount,
 * since a bill's total can be hand-overridden at billing — see POST .../bill — independently
 * of its lines). Defensively re-applies the BILLED/DISPATCHED filter itself (on top of
 * whatever the caller already queried for) so it's fully testable from fixtures alone, and
 * `productId` narrows to that product's lines only — an invoice with none left is dropped
 * entirely rather than appearing with a zero.
 *
 * Saved/given are counted across every matching line regardless of hasScheme (per line:
 * add to saved when the invoice is hasScheme=false, to given when true). Everything else —
 * billed, atScheme, the breakdowns, the bills list — is scoped to the hasScheme=false bills
 * only; `given` is informational context, not part of that population.
 *
 * Also discards an *estimated* scheme price that's higher than the line's own unitPrice —
 * a stale guess (the product's scheme has since changed), not a real negative saving. See
 * the comment inline. This runs regardless of whether migration 0013 (which does the same
 * cleanup directly in the database) has been applied.
 */
export function computeSchemeSavings(invoices: SchemeSavingsInvoiceInput[], filters: { productId?: string } = {}): SchemeSavingsResponse {
  let billed = 0;
  let saved = 0;
  let given = 0;
  let noSchemeLines = 0;
  let estimatedLines = 0;

  const byOutlet = new Map<string, AggRow>();
  const byProduct = new Map<string, AggRow>();
  const byAgent = new Map<string, AggRow>();
  const byMonth = new Map<string, AggRow>();
  const bills: SchemeSavingsBillRow[] = [];

  for (const inv of invoices) {
    if (!COUNTED_STATUSES.includes(inv.fulfilmentStatus)) continue;
    if (!inv.billedAt) continue; // shouldn't happen for BILLED/DISPATCHED, but keeps this total

    const items = filters.productId ? inv.items.filter((i) => i.productId === filters.productId) : inv.items;
    if (items.length === 0) continue;

    const lines: SchemeSavingsBillLine[] = [];
    let invBilled = 0;
    let invSaved = 0;

    for (const item of items) {
      invBilled = round2(invBilled + item.subtotal);

      // An *estimated* scheme price (back-filled from the product's current price, not
      // captured live at billing) that's higher than what this line actually billed at is
      // provably wrong — a scheme price is a discount, so it can't exceed the real price,
      // and this can only mean the product's scheme has changed since. Treat it exactly
      // like no scheme price was captured at all, rather than showing a nonsensical
      // negative "saved". A live-captured snapshot is never second-guessed this way — it's
      // what genuinely applied at billing time, whatever the numbers look like now.
      const unreliable = item.schemeEstimated && item.schemeUnitPrice != null && item.schemeUnitPrice > item.unitPrice;
      const schemeUnitPrice = unreliable ? null : item.schemeUnitPrice;

      let lineSaved = 0;
      if (schemeUnitPrice == null) {
        noSchemeLines++;
      } else {
        if (item.schemeEstimated) estimatedLines++;
        lineSaved = round2((item.unitPrice - schemeUnitPrice) * item.quantity);
        if (inv.hasScheme) given = round2(given + lineSaved);
        else {
          saved = round2(saved + lineSaved);
          invSaved = round2(invSaved + lineSaved);
        }
      }

      lines.push({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        schemeUnitPrice,
        schemeEstimated: schemeUnitPrice != null && item.schemeEstimated,
        saved: lineSaved,
      });

      if (!inv.hasScheme) bump(byProduct, item.productId, item.productName, item.subtotal, lineSaved);
    }

    if (inv.hasScheme) continue;

    billed = round2(billed + invBilled);
    bills.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      outletName: inv.outletName,
      agentName: inv.staffName,
      billedAt: inv.billedAt.toISOString(),
      billedAmount: invBilled,
      atScheme: round2(invBilled - invSaved),
      saved: invSaved,
      items: lines,
    });

    bump(byOutlet, inv.outletId, inv.outletName, invBilled, invSaved);
    bump(byAgent, inv.staffId, inv.staffName, invBilled, invSaved);
    const { key, label } = istMonth(inv.billedAt);
    bump(byMonth, key, label, invBilled, invSaved);
  }

  bills.sort((a, b) => b.billedAt.localeCompare(a.billedAt));
  const byMonthRows = toBreakdownRows(byMonth).sort((a, b) => a.id.localeCompare(b.id));

  return {
    billed,
    atScheme: round2(billed - saved),
    saved,
    given,
    net: round2(saved - given),
    pctSaved: billed > 0 ? round2((saved / billed) * 100) : 0,
    billCount: bills.length,
    noSchemeLines,
    estimatedLines,
    byOutlet: toBreakdownRows(byOutlet),
    byProduct: toBreakdownRows(byProduct),
    byAgent: toBreakdownRows(byAgent),
    byMonth: byMonthRows,
    bills,
  };
}

export interface SchemeSavingsFilters {
  from?: Date;
  to?: Date;
  outletId?: string;
  productId?: string;
  staffId?: string;
}

/** Fetches what's needed and hands it to computeSchemeSavings. The DB-level status/product
 * filters here are an optimisation (less fetched); computeSchemeSavings re-checks both
 * itself regardless. */
export async function buildSchemeSavings(filters: SchemeSavingsFilters = {}): Promise<SchemeSavingsResponse> {
  const dateFilter = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined;

  const invoices = await prisma.invoice.findMany({
    where: {
      fulfilmentStatus: { in: ["BILLED", "DISPATCHED"] },
      billedAt: dateFilter,
      outletId: filters.outletId,
      staffId: filters.staffId,
      items: filters.productId ? { some: { productId: filters.productId } } : undefined,
    },
    orderBy: { billedAt: "asc" },
    select: {
      id: true,
      invoiceNumber: true,
      billedAt: true,
      fulfilmentStatus: true,
      hasScheme: true,
      outletId: true,
      outlet: { select: { name: true } },
      staffId: true,
      staff: { select: { name: true } },
      items: {
        select: {
          productId: true,
          quantity: true,
          unitPrice: true,
          subtotal: true,
          schemeUnitPrice: true,
          schemeEstimated: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  const input = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    billedAt: inv.billedAt,
    fulfilmentStatus: inv.fulfilmentStatus,
    hasScheme: inv.hasScheme,
    outletId: inv.outletId,
    outletName: inv.outlet.name,
    staffId: inv.staffId,
    staffName: inv.staff.name,
    items: inv.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      subtotal: i.subtotal,
      schemeUnitPrice: i.schemeUnitPrice,
      schemeEstimated: i.schemeEstimated,
    })),
  }));

  return computeSchemeSavings(input, { productId: filters.productId });
}
