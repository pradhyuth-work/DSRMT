// Generate / retry / cancel an IRN and its e-way bill for a bill made in the app.
//
// How double filing is prevented:
//  - one EInvoice row per (document number, mode), enforced by a unique index;
//  - a row is claimed (status SENDING / CANCELLING) in the database before anything is sent;
//  - no call is ever retried automatically;
//  - when no clear reply comes back the row is UNKNOWN. Sending again is then safe: the portal returns
//    the same IRN for the same invoice number instead of registering it twice.
import type { EInvoice, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS } from "@/lib/api";
import { buildEinvoice, einvoiceInclude } from "@/lib/einvoice";
import { gspPost, gspConfig, gspTestMode } from "@/lib/gstin-client";
import { signedInvoiceMismatch, str, type GspReply } from "@/lib/gsp-parse";
import { irpDocNumber } from "@/lib/invoice-series";
import { lockInvoice } from "@/lib/orders";
import { SELLER } from "@/lib/seller";
import type { EInvoiceDTO } from "@/lib/types";

/** A call that has not finished after this long is treated as dead (routes are cut off at 60s). */
const STALE_MS = 2 * 60_000;
const staleBefore = () => new Date(Date.now() - STALE_MS);
const isStale = (r: EInvoice) => r.updatedAt < staleBefore();

export interface EwbOptions {
  vehicleNo?: string;
  /** Kilometres; 0 lets the portal work it out from the two pincodes. */
  distance?: number;
}

export function toEInvoiceDTO(r: EInvoice): EInvoiceDTO {
  const stuck = isStale(r);
  return {
    invoiceId: r.invoiceId,
    docNo: r.docNo,
    testMode: r.testMode,
    // A request that died part-way shows as "no reply", so it can be acted on.
    status: (r.status === "SENDING" && stuck ? "UNKNOWN" : r.status === "CANCELLING" && stuck ? "GENERATED" : r.status) as EInvoiceDTO["status"],
    irn: r.irn,
    ackNo: r.ackNo,
    ackDate: r.ackDate,
    ewbStatus: (r.ewbStatus === "SENDING" && stuck ? "UNKNOWN" : r.ewbStatus) as EInvoiceDTO["ewbStatus"],
    ewbNo: r.ewbNo,
    ewbDate: r.ewbDate,
    ewbValidUpto: r.ewbValidUpto,
    ewbError: r.ewbError,
    vehicleNo: r.vehicleNo,
    error: r.error,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  };
}

const cleanVehicle = (v: string | null | undefined) => (v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Vehicle and distance checks shared by "generate" and "retry e-way bill". */
function checkEwb(vehicle: string, distance: number, destinationPin: number | string | undefined) {
  if (vehicle.length < 7) throw new HttpError(400, "Enter the vehicle number for the e-way bill");
  if (distance === 0 && String(destinationPin) === String(SELLER.pincode)) {
    throw new HttpError(400, `Delivery is in your own pincode (${SELLER.pincode}): enter the distance in km for the e-way bill`);
  }
}

/** Saves a result, trying twice: an IRN that was issued must not be lost to one dropped connection. */
async function save(id: string, data: Prisma.EInvoiceUpdateInput): Promise<EInvoice> {
  try {
    return await prisma.eInvoice.update({ where: { id }, data });
  } catch {
    try {
      return await prisma.eInvoice.update({ where: { id }, data });
    } catch (e) {
      console.error(`Could not save the GSP result for e-invoice row ${id}`, { irn: data.irn, ewbNo: data.ewbNo });
      throw e;
    }
  }
}

export async function generateEinvoice(invoiceId: string, ewayBill: EwbOptions | null, userName: string): Promise<EInvoice> {
  const config = gspConfig();
  if (!config.ready) throw new HttpError(503, config.problem!);
  const testMode = config.testMode;

  const claim = await prisma.$transaction(async (tx) => {
    // The same row lock the cancel routes take, so a bill can't be reversed while it is being claimed.
    await lockInvoice(tx, invoiceId);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: einvoiceInclude });
    if (inv.fulfilmentStatus !== "BILLED" && inv.fulfilmentStatus !== "DISPATCHED") throw new HttpError(409, "Only a billed invoice can get an IRN");
    const built = buildEinvoice(inv);
    if (!built.json) throw new HttpError(400, built.errors.join("; "));
    const doc = built.json as Record<string, unknown> & {
      DocDtls: { No: string; Dt: string };
      BuyerDtls: { Gstin: string; Pin: number };
      ShipDtls?: { Pin: number };
      ValDtls: { TotInvVal: number };
    };
    delete doc.EwbDtls;
    let vehicle: string | null = null;
    if (ewayBill) {
      vehicle = cleanVehicle(ewayBill.vehicleNo ?? inv.vehicleNo);
      const distance = ewayBill.distance ?? 0;
      checkEwb(vehicle, distance, doc.ShipDtls?.Pin ?? doc.BuyerDtls.Pin);
      doc.EwbDtls = { Distance: distance, TransMode: "1", VehNo: vehicle, VehType: "R" };
    }
    const docNo = doc.DocDtls.No;

    if (testMode) {
      const live = await tx.eInvoice.findUnique({ where: { docNo_testMode: { docNo, testMode: false } } });
      if (live && live.invoiceId === invoiceId && live.status !== "FAILED") throw new HttpError(409, "This bill already has a live IRN record, so no test one is made");
    }
    const fresh = {
      invoiceId, status: "SENDING", irn: null, ackNo: null, ackDate: null, qrImage: null, signedInvoice: null,
      ewbStatus: ewayBill ? "SENDING" : "NOT_REQUESTED", ewbNo: null, ewbDate: null, ewbValidUpto: null, ewbError: null,
      vehicleNo: vehicle, error: null, cancelledAt: null, cancelReason: null, createdBy: userName,
    };
    const old = await tx.eInvoice.findUnique({ where: { docNo_testMode: { docNo, testMode } } });
    if (old) {
      const sameBill = old.invoiceId === invoiceId;
      if (old.status === "SENDING" && !isStale(old)) throw new HttpError(409, "This bill is being sent right now: wait a moment and refresh");
      if (!testMode && !sameBill && old.status !== "FAILED") throw new HttpError(409, `${docNo} was already filed for another bill: a number can't be registered twice`);
      if (sameBill && (old.status === "GENERATED" || old.status === "CANCELLING")) throw new HttpError(409, "This bill already has an IRN");
      if (!testMode && sameBill && old.status === "CANCELLED") throw new HttpError(409, "The IRN for this number was cancelled; the portal does not allow the same number again");
    }
    const row = old
      ? await tx.eInvoice.update({ where: { id: old.id }, data: fresh })
      : await tx.eInvoice.create({ data: { ...fresh, docNo, testMode } });
    if (vehicle && !testMode && vehicle !== inv.vehicleNo) await tx.invoice.update({ where: { id: invoiceId }, data: { vehicleNo: vehicle } });
    return { row, doc };
  }, { timeout: TRANSACTION_TIMEOUT_MS });

  const { row, doc } = claim;
  const reply = await gspPost("/v1/einvoice", testMode, { txn_type: "INV", payload: doc });

  if (reply.kind !== "ok") {
    const status = reply.kind === "rejected" ? "FAILED" : "UNKNOWN";
    return save(row.id, { status, error: reply.message, ewbStatus: "NOT_REQUESTED" });
  }
  const d = reply.data;
  const irn = str(d.irn);
  if (!irn) return save(row.id, { status: "UNKNOWN", error: "The GSP replied without an IRN", ewbStatus: "NOT_REQUESTED" });
  const signed = str(d.signed_invoice);
  if (d.already_existed === true) {
    const differs = signedInvoiceMismatch(signed, { buyerGstin: doc.BuyerDtls.Gstin, total: doc.ValDtls.TotInvVal, date: doc.DocDtls.Dt });
    if (differs) {
      return save(row.id, { status: "FAILED", ewbStatus: "NOT_REQUESTED", error: `${row.docNo} is already registered on the portal for a different invoice (${differs}). This bill has NO IRN: check the invoice number series.` });
    }
  }
  return save(row.id, {
    status: "GENERATED",
    irn,
    ackNo: str(d.ack_no),
    ackDate: str(d.ack_date),
    qrImage: str(d.qr_code_image),
    signedInvoice: signed,
    error: null,
    ...ewbFields(d, ewayBill !== null),
  });
}

/** The e-way bill part of an e-invoice reply. */
function ewbFields(d: Record<string, unknown>, wanted: boolean) {
  const no = str(d.ewaybill_no);
  if (no) return { ewbStatus: "GENERATED", ewbNo: no, ewbDate: str(d.ewaybill_date), ewbValidUpto: str(d.ewaybill_valid_upto), ewbError: null };
  if (!wanted) return { ewbStatus: "NOT_REQUESTED" };
  const why = str(d.ewaybill_error);
  return { ewbStatus: why ? "FAILED" : "UNKNOWN", ewbError: why ?? "The reply had no e-way bill. Press retry: if one already exists it is returned, not made twice." };
}

/** The row for the bill's present number in the present mode. */
async function currentRow(tx: Prisma.TransactionClient, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: einvoiceInclude });
  const testMode = gspTestMode();
  const row = inv.invoiceNumber
    ? await tx.eInvoice.findUnique({ where: { docNo_testMode: { docNo: irpDocNumber(inv.invoiceNumber), testMode } } })
    : null;
  if (!row || row.invoiceId !== invoiceId) throw new HttpError(409, `This bill has no ${testMode ? "test" : "live"} IRN`);
  return { inv, row };
}

export async function retryEwayBill(invoiceId: string, opts: EwbOptions): Promise<EInvoice> {
  const config = gspConfig();
  if (!config.ready) throw new HttpError(503, config.problem!);
  const claim = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const { inv, row } = await currentRow(tx, invoiceId);
    if (inv.fulfilmentStatus === "CANCELLED") throw new HttpError(409, "This invoice is cancelled");
    if (row.status !== "GENERATED" || !row.irn) throw new HttpError(409, "Generate the IRN first");
    if (row.ewbStatus === "GENERATED") throw new HttpError(409, "This bill already has an e-way bill");
    if (row.ewbStatus === "CANCELLED") throw new HttpError(409, "The e-way bill for this IRN was cancelled");
    if (row.ewbStatus === "SENDING" && !isStale(row)) throw new HttpError(409, "The e-way bill is being made right now: wait a moment and refresh");
    const vehicle = cleanVehicle(opts.vehicleNo ?? row.vehicleNo ?? inv.vehicleNo);
    const distance = opts.distance ?? 0;
    checkEwb(vehicle, distance, inv.shipToPincode ?? inv.outlet.pincode ?? undefined);
    const updated = await tx.eInvoice.update({ where: { id: row.id }, data: { ewbStatus: "SENDING", ewbError: null, vehicleNo: vehicle } });
    if (!row.testMode && vehicle !== inv.vehicleNo) await tx.invoice.update({ where: { id: invoiceId }, data: { vehicleNo: vehicle } });
    return { row: updated, vehicle, distance };
  }, { timeout: TRANSACTION_TIMEOUT_MS });

  const reply = await gspPost("/v1/ewaybill/from-irn", claim.row.testMode, {
    irn: claim.row.irn,
    distance: claim.distance,
    trans_mode: "1",
    vehicle_no: claim.vehicle,
    vehicle_type: "R",
  });
  if (reply.kind !== "ok") return save(claim.row.id, { ewbStatus: reply.kind === "rejected" ? "FAILED" : "UNKNOWN", ewbError: reply.message });
  const d = reply.data;
  const no = str(d.ewaybill_no);
  if (!no) return save(claim.row.id, { ewbStatus: "UNKNOWN", ewbError: "The GSP replied without an e-way bill number" });
  return save(claim.row.id, { ewbStatus: "GENERATED", ewbNo: no, ewbDate: str(d.ewaybill_date), ewbValidUpto: str(d.ewaybill_valid_upto) ?? str(d.valid_upto), ewbError: null });
}

/** The portal's reason codes. The e-way bill list numbers "data entry mistake" and "order cancelled" the other way round. */
const EWB_REASON = { "1": "1", "2": "3", "3": "2", "4": "4" } as const;
export const CANCEL_REASONS = { "1": "Duplicate", "2": "Data entry mistake", "3": "Order cancelled", "4": "Other" } as const;

/** Cancels the e-way bill (if there is one) and then the IRN. The bill itself stays as it is. */
export async function cancelEinvoice(invoiceId: string, reason: keyof typeof CANCEL_REASONS, remark: string, confirm: string): Promise<EInvoice> {
  const config = gspConfig();
  if (!config.ready) throw new HttpError(503, config.problem!);
  const row = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const { inv, row } = await currentRow(tx, invoiceId);
    if (confirm !== inv.invoiceNumber) throw new HttpError(400, `Type ${inv.invoiceNumber} exactly to confirm`);
    if (!row.irn || (row.status !== "GENERATED" && !(row.status === "CANCELLING" && isStale(row)))) {
      throw new HttpError(409, row.status === "CANCELLING" ? "The IRN is being cancelled right now: wait a moment and refresh" : "There is no active IRN to cancel");
    }
    if (row.ewbStatus === "SENDING" && !isStale(row)) throw new HttpError(409, "The e-way bill is being made right now: wait a moment and refresh");
    return tx.eInvoice.update({ where: { id: row.id }, data: { status: "CANCELLING", error: null } });
  }, { timeout: TRANSACTION_TIMEOUT_MS });

  const failed = (what: string, reply: Exclude<GspReply, { kind: "ok" }>) =>
    save(row.id, {
      status: "GENERATED",
      error: reply.kind === "rejected"
        ? `${what} not cancelled: ${reply.message}`
        : `${what} cancellation not confirmed (${reply.message}). Check the government portal before trying again.`,
    });

  if (row.ewbStatus === "GENERATED" && row.ewbNo) {
    const reply = await gspPost("/v1/ewaybill/cancel", row.testMode, { ewaybill_no: row.ewbNo, cancel_reason_code: EWB_REASON[reason], cancel_remark: remark }, 25_000);
    if (reply.kind !== "ok") return failed("E-way bill", reply);
    await save(row.id, { ewbStatus: "CANCELLED" });
  }
  const reply = await gspPost("/v1/einvoice/cancel", row.testMode, { irn: row.irn, cancel_reason: reason, cancel_remark: remark }, 25_000);
  if (reply.kind !== "ok") return failed("IRN", reply);
  return save(row.id, { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `${CANCEL_REASONS[reason]}: ${remark}`, error: null });
}

/** Live records that mean the government may be holding an active invoice for this bill. */
export function activeLiveEinvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  return tx.eInvoice.findFirst({ where: { invoiceId, testMode: false, status: { in: ["SENDING", "GENERATED", "UNKNOWN", "CANCELLING"] } } });
}

/** Whether a number has ever (possibly) reached the portal in live mode, so it can't be used again. */
export async function numberFiled(tx: Prisma.TransactionClient, invoiceNumber: string) {
  const row = await tx.eInvoice.findUnique({ where: { docNo_testMode: { docNo: irpDocNumber(invoiceNumber), testMode: false } } });
  return row !== null && row.status !== "FAILED";
}
