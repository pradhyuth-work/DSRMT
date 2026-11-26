"use client";

import { useState } from "react";
import { FileCheck, Loader2 } from "lucide-react";
import type { EInvoiceDTO, EInvoiceListDTO, OrderDTO } from "@/lib/types";
import { api } from "./api-client";
import { Alert } from "./ui";

const EWB_LIMIT = 50_000;
const CANCEL_REASONS = [["2", "Data entry mistake"], ["3", "Order cancelled"], ["1", "Duplicate"], ["4", "Other"]] as const;

/** The records that belong to a bill's present number: the live one, and the one for the present mode. */
export function irnFor(order: OrderDTO, list: EInvoiceListDTO | null) {
  const docNo = (order.invoiceNumber ?? "").trim().replace(/\s+/g, "-");
  const mine = list?.records.filter((r) => r.invoiceId === order.id && r.docNo === docNo) ?? [];
  const live = mine.find((r) => !r.testMode);
  const current = mine.find((r) => r.testMode === list?.testMode);
  // In test mode a real filing still shows, so nobody mistakes the bill for unfiled.
  const shown = live && live.status !== "FAILED" ? live : current;
  return { shown, live };
}

/** True when the government may be holding an active invoice. */
export const irnActive = (r: EInvoiceDTO | undefined) => !!r && !r.testMode && r.status !== "FAILED" && r.status !== "CANCELLED";

export function irnLabel(r: EInvoiceDTO): string {
  const text =
    r.status === "GENERATED" ? (r.ewbStatus === "GENERATED" ? "IRN + e-way" : r.ewbStatus === "FAILED" || r.ewbStatus === "UNKNOWN" ? "IRN, e-way pending" : "IRN")
    : r.status === "CANCELLED" ? "IRN cancelled"
    : r.status === "FAILED" ? "IRN refused"
    : r.status === "UNKNOWN" ? "IRN: check"
    : "IRN in progress";
  return r.testMode ? `Test ${text}` : text;
}

/** Generate IRN + e-way bill in one press, retry the e-way bill, and cancel — for the selected invoice. */
export function IrnPanel({ order, gstin, list, loadError, isAdmin, onChanged }: {
  order: OrderDTO; gstin: string | null; list: EInvoiceListDTO | null; loadError: string | null; isAdmin: boolean; onChanged: () => Promise<void>;
}) {
  const { shown: r } = irnFor(order, list);
  const [wantEwb, setWantEwb] = useState(order.totalAmount > EWB_LIMIT);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [distance, setDistance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<string>("2");
  const [remark, setRemark] = useState("");
  const [confirm, setConfirm] = useState("");

  const vehicleValue = vehicle ?? r?.vehicleNo ?? order.vehicleNo ?? order.agentVehicleNo ?? "";
  const ewbInput = { vehicleNo: vehicleValue.trim() || undefined, distance: distance ? Number(distance) : 0 };
  const cancelledOrder = order.fulfilmentStatus === "CANCELLED";
  // A record made in the other mode is shown but can't be acted on.
  const otherMode = !!r && !!list && r.testMode !== list.testMode;

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    // Always re-read: even a failed request may have changed the record.
    await onChanged();
    setBusy(false);
  }
  const generate = () => run(() => api.generateIrn(order.id, { ewayBill: wantEwb ? ewbInput : null }));

  const vehicleFields = (
    <div className="grid grid-cols-[2fr_1fr] gap-2">
      <div><label className="label" htmlFor="irn-veh">Vehicle number</label><input id="irn-veh" className="input" value={vehicleValue} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="KA01AB1234" /></div>
      <div><label className="label" htmlFor="irn-km">Distance km</label><input id="irn-km" className="input" inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Auto" /></div>
    </div>
  );
  const spinner = busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />;

  let body: React.ReactNode;
  if (loadError) body = <Alert kind="error">{loadError}</Alert>;
  else if (!list) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (!r && !gstin) body = <p className="text-sm">No GSTIN on this outlet: a B2C bill, so no IRN is needed.{order.totalAmount > EWB_LIMIT ? " It is over ₹50,000: make its e-way bill on the e-way bill portal." : ""}</p>;
  else if (!list.ready) body = <Alert kind="warning">{list.problem}</Alert>;
  else if (!r && cancelledOrder) body = <p className="text-sm text-muted-foreground">Cancelled invoice: no IRN.</p>;
  else if (!r || r.status === "FAILED" || r.status === "UNKNOWN" || (r.status === "CANCELLED" && r.testMode && list.testMode)) {
    body = cancelledOrder ? <Alert kind="warning">{r?.error ?? "Check this number on the e-invoice portal."}</Alert> : (
      <>
        {r?.status === "FAILED" && <Alert kind="error">{r.error}</Alert>}
        {r?.status === "UNKNOWN" && <Alert kind="warning">{r.error ?? "No clear reply came back."} Pressing the button again is safe: the same number is not filed twice.</Alert>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wantEwb} onChange={(e) => setWantEwb(e.target.checked)} /> Make the e-way bill too</label>
        {wantEwb && vehicleFields}
        {!wantEwb && order.totalAmount > EWB_LIMIT && <Alert kind="warning">Over ₹50,000: goods need an e-way bill before they move.</Alert>}
        <button type="button" className="btn btn-primary w-full" disabled={busy || (wantEwb && !vehicleValue.trim())} onClick={() => void generate()}>
          {spinner} {r?.status === "UNKNOWN" ? "Check again" : wantEwb ? "Generate IRN + e-way bill" : "Generate IRN"}
        </button>
      </>
    );
  } else if (r.status === "SENDING" || r.status === "CANCELLING") {
    body = (
      <>
        <p className="text-sm">Being {r.status === "SENDING" ? "sent" : "cancelled"}…</p>
        <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => void run(async () => {})}>Refresh</button>
      </>
    );
  } else {
    body = (
      <>
        <dl className="space-y-1 text-xs">
          <div><dt className="text-muted-foreground">IRN{r.status === "CANCELLED" ? " (cancelled)" : ""}</dt><dd className="break-all font-mono">{r.irn}</dd></div>
          <div><dt className="text-muted-foreground">Ack no / date</dt><dd>{[r.ackNo, r.ackDate].filter(Boolean).join(" · ") || "—"}</dd></div>
          {r.ewbStatus === "GENERATED" && <div><dt className="text-muted-foreground">E-way bill</dt><dd><b>{r.ewbNo}</b>{r.ewbValidUpto ? ` · valid up to ${r.ewbValidUpto}` : ""}</dd></div>}
          {r.ewbStatus === "CANCELLED" && <div><dt className="text-muted-foreground">E-way bill</dt><dd>{r.ewbNo ?? ""} cancelled</dd></div>}
        </dl>
        {r.error && <Alert kind="error">{r.error}</Alert>}
        {r.status === "GENERATED" && !otherMode && !cancelledOrder && (r.ewbStatus === "NOT_REQUESTED" || r.ewbStatus === "FAILED" || r.ewbStatus === "UNKNOWN") && (
          <>
            {r.ewbError && <Alert kind={r.ewbStatus === "FAILED" ? "error" : "warning"}>E-way bill: {r.ewbError}</Alert>}
            {vehicleFields}
            <button type="button" className="btn btn-primary w-full" disabled={busy || !vehicleValue.trim()} onClick={() => void run(() => api.makeEwayBill(order.id, ewbInput))}>
              {spinner} {r.ewbStatus === "NOT_REQUESTED" ? "Make e-way bill" : "Retry e-way bill"}
            </button>
          </>
        )}
        {r.status === "GENERATED" && !cancelledOrder && (
          <button type="button" className="btn btn-secondary w-full" onClick={() => { api.printInvoice(order.id).catch((e) => setError(e instanceof Error ? e.message : "Could not print")); }}>Print invoice</button>
        )}
        {r.status === "GENERATED" && !otherMode && isAdmin && (!cancelling ? (
          <button type="button" className="btn btn-secondary w-full" onClick={() => setCancelling(true)}>Cancel IRN{r.ewbStatus === "GENERATED" ? " and e-way bill" : ""}</button>
        ) : (
          <div className="space-y-2 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">The portal allows this only within 24 hours. A cancelled invoice number can't be filed again.</p>
            <select className="input" aria-label="Cancel reason" value={reason} onChange={(e) => setReason(e.target.value)}>{CANCEL_REASONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            <input className="input" aria-label="Remark" placeholder="Short remark" maxLength={100} value={remark} onChange={(e) => setRemark(e.target.value)} />
            <input className="input" aria-label={`Type ${order.invoiceNumber} to confirm`} placeholder={`Type ${order.invoiceNumber}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button type="button" className="btn btn-primary w-full" disabled={busy || remark.trim().length < 3 || confirm.trim() !== order.invoiceNumber}
              onClick={() => void run(() => api.cancelIrn(order.id, { reason, remark: remark.trim(), confirm: confirm.trim() }))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm cancel
            </button>
            <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => setCancelling(false)}>Back</button>
          </div>
        ))}
      </>
    );
  }

  const test = r ? r.testMode : list?.testMode;
  return (
    <section aria-label="E-invoice" className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold tracking-widest text-muted-foreground">E-INVOICE &amp; E-WAY BILL</div>
        {list && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${test ? "border-warning/40 text-warning-foreground" : "border-accent/40 text-accent"}`}>{test ? "Test mode" : "Live"}</span>}
      </div>
      <p className="font-mono text-sm font-bold">{order.invoiceNumber} · {order.outletName}</p>
      {test && list?.ready && <p className="text-xs text-muted-foreground">Nothing is sent to the government. Numbers made here are not valid.</p>}
      {body}
      {error && <Alert kind="error">{error}</Alert>}
    </section>
  );
}
