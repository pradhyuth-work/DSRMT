"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileCheck, Loader2, Pencil } from "lucide-react";
import type { AuthUser, EInvoiceListDTO, InvoiceSeriesDTO, OrderDTO, ProductDTO } from "@/lib/types";
import { formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import { EinvoicePanel } from "./EinvoicePanel";
import { IrnPanel, irnActive, irnFor, irnLabel } from "./IrnPanel";
import { EditOrderForm } from "./OrdersView";
import PosBilling from "./PosBilling";
import TaxReports from "./TaxReports";
import { SELLER } from "@/lib/seller";
import { ShipToFields, emptyShipTo, shipToIncomplete, shipToInput, type ShipToForm } from "./ShipTo";
import type { DashboardData } from "./Dashboard";

export type BillTab = "desk" | "invoices" | "pos" | "reports";
/** Billing sections, shown in the side panel (and the phone menu) rather than as tabs on the page. */
export const billTabsFor = (isAdmin: boolean): { id: BillTab; label: string; helper: string }[] => [
  { id: "desk", label: "Orders to bill", helper: "Turn orders into invoices" },
  { id: "invoices", label: "Invoices", helper: "Print, cancel, correct" },
  ...(isAdmin ? [{ id: "pos" as const, label: "POS billing", helper: "Counter sale" }, { id: "reports" as const, label: "Tax reports", helper: "GSTR-1, 3B, registers" }] : []),
];

const SELLER_NAME = "VARASIDHI ENTERPRISES";
const SELLER_GSTIN = "29AEXPR8267H1ZC";
const REASONS = ["Data entry mistake", "Wrong outlet", "Customer declined", "Other"] as const;

/** Rule 31D split for one line: tax is worked on MRP, taxable value is what is billed minus that tax. */
function lineTax(item: OrderDTO["items"][number], product: ProductDTO | undefined) {
  const gross = item.unitPrice * item.quantity;
  const rate = product?.gstRate ?? 40;
  const mrp = product?.mrp ?? null;
  if (!mrp) return { gross, mrp: null, tax: null as number | null, net: null as number | null, rate };
  const tax = round2((mrp * item.quantity * rate) / (100 + rate));
  return { gross, mrp, tax, net: round2(gross - tax), rate };
}

const PAGE_SIZE = 20;

/**
 * The Billing mode: a desk that turns pending orders into GST invoices (queue, draft invoice, steps)
 * and an Invoices list with cancel / correct. Operations keeps the order cards as they were.
 */
export default function BillingMode({
  data, user, onSaved, focusOrderId, tab,
}: { data: DashboardData; user: AuthUser; onSaved: () => Promise<void>; focusOrderId?: string | null; tab: BillTab }) {
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [series, setSeries] = useState<InvoiceSeriesDTO | null>(null);
  const isAdmin = user.role === "admin";

  const loadSeries = () => api.getInvoiceSeries().then(setSeries).catch(() => setSeries(null));
  useEffect(() => { void loadSeries(); }, [data.orders]);
  // The result of billing shows at the top, which on a phone is well above the button that was pressed.
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) messageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [message]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm">
        <span className="font-semibold text-accent">Billing mode</span>
        <span className="ml-2 opacity-85">Turn orders into GST invoices. Everything here follows the invoice number series.</span>
      </div>
      {message && <div ref={messageRef} className="scroll-mt-20"><Alert kind={message.kind}>{message.text}</Alert></div>}
      {tab === "desk" && (
        <Desk data={data} user={user} series={series} focusOrderId={focusOrderId ?? null}
          onDone={async (text, kind = "success") => { setMessage({ kind, text }); await onSaved(); await loadSeries(); }}
          onError={(text) => setMessage({ kind: "error", text })} />
      )}
      {tab === "pos" && isAdmin && (
        <PosBilling data={data}
          onDone={async (text) => { setMessage({ kind: "success", text }); await onSaved(); await loadSeries(); }}
          onError={(text) => setMessage({ kind: "error", text })} />
      )}
      {tab === "reports" && isAdmin && <TaxReports />}
      {tab === "invoices" && (
        <Invoices data={data} series={series} isAdmin={isAdmin}
          onDone={async (text) => { setMessage({ kind: "success", text }); await onSaved(); await loadSeries(); }} />
      )}
    </div>
  );
}

/** A pending order in the "Orders to bill" queue: who, what, how it is priced and the tax split, with a button to bill it. */
function QueueCard({ o, selected, productById, gstin, onPick, className = "" }: { o: OrderDTO; selected: boolean; productById: Map<string, ProductDTO>; gstin: string | null; onPick: () => void; className?: string }) {
  const lines = o.items.map((i) => ({ i, ...lineTax(i, productById.get(i.productId)) }));
  const known = lines.every((l) => l.tax !== null);
  const tax = lines.reduce((x, l) => x + (l.tax ?? 0), 0);
  const gross = lines.reduce((x, l) => x + l.gross, 0);
  const qty = o.items.reduce((x, i) => x + i.quantity, 0);
  const sc = schemeState(o);
  return (
    <article className={`card flex min-w-0 flex-col p-4 ${selected ? "ring-2 ring-accent" : ""} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold leading-tight">{o.outletName}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{o.staffName} · {formatDate(o.createdAt)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-foreground">To bill</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{gstin ? `GSTIN ${gstin}` : "No GSTIN — B2C, no e-invoice"}{o.agentVehicleNo ? ` · Vehicle ${o.agentVehicleNo}` : ""}</p>

      <ul className="my-3 space-y-2 border-y border-border py-2 text-sm">
        {lines.map((l) => (
          <li key={l.i.productId}>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 break-words"><span className="text-accent">{l.i.quantity} ×</span> {l.i.productName}</span>
              <span className="shrink-0 font-medium tabular-nums">{formatMoney(l.gross)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
              <span>{formatMoney(l.i.unitPrice)}/pc</span>
              <span>{l.mrp ? `MRP ${formatMoney(l.mrp)}` : "MRP missing"}</span>
              <span>GST {l.rate}%</span>
              {l.tax !== null && <span>Tax {formatMoney(l.tax)}</span>}
              {l.i.hasScheme && <span className="font-bold uppercase tracking-wider text-accent">Scheme</span>}
            </div>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted-foreground">Basic</dt><dd className="tabular-nums">{known ? formatMoney(round2(gross - tax)) : "—"}</dd></div>
        <div><dt className="text-muted-foreground">GST</dt><dd className="tabular-nums">{known ? formatMoney(round2(tax)) : "—"}</dd></div>
        <div><dt className="text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{formatMoney(o.totalAmount)}</dd></div>
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">{o.items.length} item{o.items.length === 1 ? "" : "s"} · {qty} pcs · <span className={sc === "none" ? "" : "font-bold uppercase tracking-wider text-accent"}>{SCHEME_LABEL[sc]}</span></p>

      <button type="button" onClick={onPick} className={`btn mt-3 h-11 w-full text-sm ${selected ? "btn-primary" : "btn-secondary"}`}>
        <FileCheck className="h-4 w-4" /> {selected ? "Selected — bill below" : "Bill this order"}
      </button>
    </article>
  );
}

/** Whether an order is priced with scheme rates: every line, some lines, or none. */
function schemeState(o: OrderDTO): "all" | "some" | "none" {
  const n = o.items.filter((i) => i.hasScheme).length;
  return n === 0 ? "none" : n === o.items.length ? "all" : "some";
}
const SCHEME_LABEL = { all: "Scheme ON", some: "Scheme on some lines", none: "No scheme" } as const;

/* ------------------------------------------------------------------ desk */

function Desk({
  data, user, series, focusOrderId, onDone, onError,
}: {
  data: DashboardData; user: AuthUser; series: InvoiceSeriesDTO | null; focusOrderId: string | null;
  onDone: (text: string, kind?: "success" | "error") => Promise<void>; onError: (text: string) => void;
}) {
  const queue = useMemo(
    () => data.orders.filter((o) => o.fulfilmentStatus === "PENDING").sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.orders],
  );
  const [selId, setSelId] = useState<string | null>(focusOrderId);
  const order = queue.find((o) => o.id === selId) ?? queue[0] ?? null;
  const [vehicleNo, setVehicleNo] = useState("");
  const [shipTo, setShipTo] = useState<ShipToForm>(emptyShipTo());
  const [vehicleFor, setVehicleFor] = useState<string | null>(null);
  // Pre-fill the vehicle with the order owner's usual one whenever a different order is picked.
  if (order && vehicleFor !== order.id) { setVehicleFor(order.id); setVehicleNo(order.agentVehicleNo ?? ""); }
  const [outside, setOutside] = useState(false);
  const [outNo, setOutNo] = useState("");
  const [outAmt, setOutAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<OrderDTO | null>(null);

  const [wantEwb, setWantEwb] = useState(true);
  const [distance, setDistance] = useState("");
  // Whether the GSP is set up, and in test or live mode: undefined = still loading, null = could not be read.
  const [gsp, setGsp] = useState<EInvoiceListDTO | null | undefined>(undefined);
  useEffect(() => { api.einvoiceRecords().then(setGsp).catch(() => setGsp(null)); }, []);

  useEffect(() => { setOutside(false); setOutNo(""); setOutAmt(order ? String(order.totalAmount) : ""); setShipTo(emptyShipTo()); setWantEwb(true); setDistance(""); }, [order?.id]);

  // Swipe rail (phone): which card is showing, kept in step with the scroll position.
  const railRef = useRef<HTMLDivElement>(null);
  const [cardIdx, setCardIdx] = useState(0);
  function onRailScroll() {
    const el = railRef.current;
    if (!el || el.clientWidth === 0) return;
    const first = el.firstElementChild as HTMLElement | null;
    const step = first ? first.offsetWidth + 12 : el.clientWidth;
    setCardIdx(Math.max(0, Math.min(queue.length - 1, Math.round(el.scrollLeft / step))));
  }
  // Open the rail on the focused order (when arriving from an order card elsewhere).
  useEffect(() => {
    if (!focusOrderId) return;
    const i = queue.findIndex((o) => o.id === focusOrderId);
    const card = railRef.current?.children[i] as HTMLElement | undefined;
    if (card) railRef.current!.scrollTo({ left: card.offsetLeft - railRef.current!.offsetLeft, behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOrderId]);
  // Keep the index valid after an order is billed and leaves the queue.
  useEffect(() => { setCardIdx((i) => Math.min(i, Math.max(0, queue.length - 1))); }, [queue.length]);

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const outlet = order ? data.outlets.find((o) => o.id === order.outletId) : undefined;
  const nextLabel = series?.next ? `${series.prefix} ${series.reusable[0] ?? series.next}` : null;

  const lines = order ? order.items.map((i) => ({ i, ...lineTax(i, productById.get(i.productId)) })) : [];
  const missingMrp = lines.filter((l) => l.mrp === null).map((l) => l.i.productName);
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const taxSum = lines.reduce((s, l) => s + (l.tax ?? 0), 0);
  const netSum = lines.reduce((s, l) => s + (l.net ?? 0), 0);
  const total = Math.round(gross);

  // A GSTIN outlet is filed with the GSP straight after billing.
  const willFile = !!outlet?.gstNumber && !!gsp?.ready;
  const ewb = willFile && wantEwb;
  const needDistance = ewb && String(shipToInput(shipTo)?.pincode ?? outlet?.pincode ?? "") === String(SELLER.pincode);
  const ewbMissing = !ewb ? null
    : vehicleNo.replace(/[^A-Za-z0-9]/g, "").length < 7 ? "Enter the vehicle number for the e-way bill, or untick it."
    : needDistance && !(Number(distance) > 0) ? "Delivery is in your own pincode: enter the distance in km, or untick the e-way bill."
    : null;

  async function generate() {
    if (!order) return;
    setBusy(true);
    const vehicle = vehicleNo.trim() || undefined;
    let billed: OrderDTO;
    try {
      billed = await api.billOrder(order.id, { vehicleNo: vehicle, shipTo: shipToInput(shipTo) });
    } catch (e) { onError(e instanceof Error ? e.message : "Could not bill"); setBusy(false); return; }
    // Portal and server messages may or may not end with a full stop.
    const why = (s: string | null | undefined) => (s ?? "no reply").replace(/[.\s]*$/, ".");
    const made = `Invoice ${billed.invoiceNumber} made for ${formatMoney(billed.totalAmount)}`;
    if (!willFile) {
      const notFiled = !outlet?.gstNumber ? "" : `. E-invoice NOT filed: ${why(gsp?.problem ?? "the e-invoice set-up could not be read")}`;
      await onDone(made + notFiled, notFiled ? "error" : "success");
    } else {
      // The invoice now exists whatever happens next; a failure here is retried under Invoices, never re-billed.
      const test = gsp.testMode ? "Test " : "";
      try {
        const r = await api.generateIrn(billed.id, { ewayBill: ewb ? { vehicleNo: vehicle, distance: needDistance ? Number(distance) : 0 } : null });
        if (r.status === "FAILED") await onDone(`${made}, but the ${test}IRN was refused: ${why(r.error)} Fix it, then try again under Invoices.`, "error");
        else if (r.status !== "GENERATED") await onDone(`${made}, but the ${test}IRN is not confirmed: ${why(r.error)} Check it under Invoices.`, "error");
        else if (ewb && r.ewbStatus !== "GENERATED") await onDone(`${made}. ${test}IRN made, but not the e-way bill: ${why(r.ewbError)} Open Invoices to retry it.`, "error");
        else await onDone(`${made}. ${test}IRN made${r.ewbNo ? `, e-way bill ${r.ewbNo}` : ""}.`);
      } catch (e) {
        await onDone(`${made}, but the e-invoice step failed: ${why(e instanceof Error ? e.message : null)} Open Invoices to check it.`, "error");
      }
    }
    setBusy(false);
  }
  async function saveOutside() {
    if (!order) return;
    setBusy(true);
    try {
      await api.billOrder(order.id, { invoiceNumber: outNo.trim(), amount: Number.parseFloat(outAmt) });
      await onDone(`Bill ${outNo.trim()} recorded (billed outside the app)`);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not save"); }
    setBusy(false);
  }

  if (queue.length === 0) return <EmptyState>No orders waiting to be billed.</EmptyState>;
  const canEdit = user.role === "admin";
  const steps = [
    { t: `Take invoice number ${nextLabel ?? "(set the start first)"}`, n: "Next in the MTR series" },
    { t: "Take stock out", n: "Stock leaves the inventory when the invoice is made" },
    { t: "Save the GST invoice", n: "Locks the amount; payments are collected against it" },
    { t: "File the e-invoice", n: "IRN + e-way bill straight away for outlets with a GSTIN" },
  ];

  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* queue — one detailed card per order, like the order cards in Operations */}
      <section aria-label="Queue" className="order-1 w-full">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-widest text-muted-foreground">
          <span>TO BILL</span>
          <span className="text-accent">
            <span className="sm:hidden">{Math.min(cardIdx + 1, queue.length)} / </span>{queue.length}
          </span>
        </div>
        {/* Phone: one card at a time, swipe sideways for the next. Wider screens keep the grid. */}
        <div ref={railRef} onScroll={onRailScroll}
          className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible xl:grid-cols-3">
          {queue.map((o) => (
            <QueueCard key={o.id} o={o} selected={order?.id === o.id} productById={productById}
              className="w-full shrink-0 snap-center [scroll-snap-stop:always] sm:w-auto sm:shrink"
              gstin={data.outlets.find((x) => x.id === o.outletId)?.gstNumber ?? null}
              onPick={() => { setSelId(o.id); setTimeout(() => document.getElementById("bill-actions")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} />
          ))}
        </div>
        {queue.length > 1 && (
          <div className="mt-2 flex justify-center gap-1.5 sm:hidden" aria-hidden>
            {queue.map((o, i) => (
              <span key={o.id} className={`h-1.5 rounded-full transition-all ${i === cardIdx ? "w-4 bg-accent" : "w-1.5 bg-muted-foreground/40"}`} />
            ))}
          </div>
        )}
      </section>

      {/* draft invoice paper */}
      <section aria-label="Draft invoice" className="order-3 min-w-0 flex-1 basis-[400px] md:order-2">
        {order && (
          <div className="rounded-md bg-[#F4EFE3] p-3 text-[#1B2B2A] shadow sm:p-5">
            <div className="flex items-start justify-between border-b-2 border-[#0F2B2A] pb-2">
              <div className="flex items-center gap-2"><img src="/varasidhi-logo.png" alt="" className="h-10 w-10 rounded-lg" /><div><div className="text-lg font-bold tracking-wider">{SELLER_NAME}</div><div className="text-xs">GSTIN {SELLER_GSTIN}</div></div></div>
              <div className="text-right"><div className="text-sm font-bold tracking-[.18em]">TAX INVOICE</div><div className="text-[10px] tracking-widest text-[#8a5a00]">DRAFT · NOT YET ISSUED</div></div>
            </div>
            <div className="mt-3 flex justify-between gap-4">
              <div><div className="text-[10px] tracking-widest opacity-70">BILLED TO</div><div className="font-bold">{order.outletName}</div>
                <div className="text-xs">{outlet?.gstNumber ? `GSTIN: ${outlet.gstNumber}` : "No GSTIN — B2C, no e-invoice"}</div></div>
              <div className="text-right"><div className="text-[10px] tracking-widest opacity-70">INVOICE NO</div><div className="text-xl font-bold">{nextLabel ?? "—"}</div><div className="text-xs">Supply: Karnataka</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#0F2B2A]">{SCHEME_LABEL[schemeState(order)]}</div></div>
            </div>
            <div className="mt-3 overflow-x-auto"><div className="min-w-[460px] text-xs">
              <div className="grid grid-cols-[2fr_.6fr_.8fr_.8fr_1fr_1fr] gap-1 border-b border-[#0F2B2A]/40 pb-1 font-bold">
                <div>ITEM</div><div className="text-right">QTY</div><div className="text-right">MRP</div><div className="text-right">RATE</div><div className="text-right">TAXABLE</div><div className="text-right">GST 40%</div>
              </div>
              {lines.map((l) => (
                <div key={l.i.productId} className="grid grid-cols-[2fr_.6fr_.8fr_.8fr_1fr_1fr] gap-1 border-b border-[#0F2B2A]/10 py-1">
                  <div>{l.i.productName}{l.i.hasScheme && <span className="ml-1 rounded bg-[#0F2B2A] px-1 text-[9px] font-bold text-white">SCHEME</span>}</div><div className="text-right">{l.i.quantity}</div>
                  <div className="text-right">{l.mrp ?? "—"}</div><div className="text-right">{l.i.unitPrice}</div>
                  <div className="text-right">{l.net === null ? "—" : l.net.toFixed(2)}</div><div className="text-right">{l.tax === null ? "—" : l.tax.toFixed(2)}</div>
                </div>
              ))}
            </div></div>
            <div className="mt-3 flex justify-end"><div className="w-64 text-xs">
              <div className="flex justify-between py-0.5"><span>Sub total</span><span>{missingMrp.length ? "—" : netSum.toFixed(2)}</span></div>
              <div className="flex justify-between py-0.5"><span>GST (RSP based)</span><span>{missingMrp.length ? "—" : taxSum.toFixed(2)}</span></div>
              <div className="mt-1 flex justify-between border-t-2 border-[#0F2B2A] pt-1 text-sm font-bold"><span>NET AMOUNT</span><span>{formatMoney(total)}</span></div>
            </div></div>
          </div>
        )}
        {missingMrp.length > 0 && <div className="mt-2"><Alert kind="warning">MRP missing for {missingMrp.join(", ")} — add it under Invoices → E-invoice details so tax can be shown.</Alert></div>}
      </section>

      {/* steps */}
      <aside id="bill-actions" aria-label="Steps" className="card order-2 scroll-mt-20 w-full shrink-0 space-y-3 p-4 md:order-3 lg:w-72">
        <div className="hidden text-xs font-semibold tracking-widest text-muted-foreground md:block">WHAT HAPPENS</div>
        {steps.map((s, i) => (
          <div key={s.t} className="hidden gap-3 md:flex"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent text-[11px] text-accent">{i + 1}</span>
            <span className="text-sm leading-snug"><span className="block font-bold">{s.t}</span><span className="text-xs text-muted-foreground">{s.n}</span></span></div>
        ))}
        {!outside ? (
          <>
            <div><label className="label" htmlFor="desk-veh">Vehicle number{ewb ? " (for the e-way bill)" : " (optional)"}</label>
              <input id="desk-veh" className="input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="KA01AB1234" />
              {total > 50000 && !ewb && <p className="mt-1 text-xs text-warning-foreground">Over ₹50,000: goods need an e-way bill before they move.{outlet?.gstNumber ? "" : " Make it on the e-way bill portal."}</p>}</div>
            <ShipToFields idPrefix="desk" value={shipTo} onChange={setShipTo} />
            {willFile && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wantEwb} onChange={(e) => setWantEwb(e.target.checked)} /> Make the e-way bill too</label>
            )}
            {needDistance && (
              <div><label className="label" htmlFor="desk-km">Distance km</label><input id="desk-km" className="input" inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
            )}
            {ewbMissing && <p className="text-xs text-warning-foreground">{ewbMissing}</p>}
            {willFile && <p className="text-xs text-muted-foreground">{gsp.testMode ? "Test mode: the e-invoice is a trial and nothing reaches the government." : `LIVE: this also files the ${ewb ? "e-invoice and e-way bill" : "e-invoice"} with the government.`}</p>}
            {outlet?.gstNumber && gsp !== undefined && !gsp?.ready && <Alert kind="warning">This will make the invoice only, not the e-invoice: {gsp?.problem ?? "the e-invoice set-up could not be read"}</Alert>}
            {outlet && !outlet.gstNumber && <p className="text-xs text-muted-foreground">No GSTIN on this outlet: invoice only, no e-invoice or e-way bill.</p>}
            {!nextLabel && <Alert kind="warning">Set the starting invoice number first (Invoices → numbering).</Alert>}
            <button type="button" className="btn btn-primary w-full" disabled={busy || !nextLabel || shipToIncomplete(shipTo) || gsp === undefined || !!ewbMissing} onClick={() => void generate()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />} Generate invoice
            </button>
            {canEdit && order && (
              <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => setEditing(order)}><Pencil className="h-4 w-4" /> Edit order</button>
            )}
            <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => setOutside(true)}>Billed outside the app</button>
          </>
        ) : (
          <>
            <Alert kind="warning">Recorded and flagged as billed outside the app. No GST invoice or e-invoice is made here.</Alert>
            <div><label className="label" htmlFor="out-no">Bill number</label><input id="out-no" className="input" value={outNo} onChange={(e) => setOutNo(e.target.value)} placeholder="e.g. SAC 1042" /></div>
            <div><label className="label" htmlFor="out-amt">Bill amount</label><input id="out-amt" type="number" className="input" value={outAmt} onChange={(e) => setOutAmt(e.target.value)} /></div>
            <button type="button" className="btn btn-primary w-full" disabled={busy || !outNo.trim() || !(Number.parseFloat(outAmt) > 0)} onClick={() => void saveOutside()}>Save bill</button>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setOutside(false)}>Back</button>
          </>
        )}
        <p className="text-xs text-muted-foreground">Once an invoice is made, mistakes go through Cancel or correct under Invoices.</p>
      </aside>

      <Modal open={!!editing} title={`Edit order — ${editing?.outletName ?? ""}`} onClose={() => setEditing(null)}>
        {editing && (
          <EditOrderForm key={editing.id} order={editing} data={data}
            onDone={async (text) => { setEditing(null); await onDone(text); }} />
        )}
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------- invoices */

function Invoices({ data, series, isAdmin, onDone }: { data: DashboardData; series: InvoiceSeriesDTO | null; isAdmin: boolean; onDone: (text: string) => Promise<void> }) {
  const list = useMemo(
    () => data.orders.filter((o) => o.invoiceNumber && (o.fulfilmentStatus !== "PENDING")).sort((a, b) => (b.billedAt ?? "").localeCompare(a.billedAt ?? "")),
    [data.orders],
  );
  const [selId, setSelId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1); // the list can shrink under us
  const shown = list.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE);
  const sel = shown.find((o) => o.id === selId) ?? null;
  const toggle = (id: string) => setSelId((cur) => (cur === id ? null : id));
  const turn = (to: number) => { setSelId(null); setPage(to); document.getElementById("invoice-list")?.scrollIntoView({ block: "start" }); };
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [back, setBack] = useState(true);
  const [reuse, setReuse] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [force, setForce] = useState(false);
  const [gsp, setGsp] = useState<EInvoiceListDTO | null>(null);
  const [gspError, setGspError] = useState<string | null>(null);
  const loadGsp = () => api.einvoiceRecords()
    .then((l) => { setGsp(l); setGspError(null); })
    .catch((e) => setGspError(e instanceof Error ? e.message : "Could not load e-invoice records"));
  useEffect(() => { void loadGsp(); }, [data.orders]);

  useEffect(() => {
    setConfirm(""); setErr(null); setReuse(false); setBack(true); setForce(false);
    // Closing a panel higher up can push the tapped bill off the screen.
    if (selId) document.getElementById(`inv-${selId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selId]);

  const live = sel ? irnFor(sel, gsp).live : undefined;
  const filed = !!live && live.status !== "FAILED";
  const active = irnActive(live);
  const reuseBlock = !sel ? "" : sel.billedOutside ? "Written outside the app — can't be reused here." : filed ? "Filed on the government portal — can't be reused." : sel.einvExportedAt ? "Already in an e-invoice file — can't be reused." : "Hands the number back so the next invoice takes it.";
  const canReuse = !!sel && !sel.billedOutside && !sel.einvExportedAt && !filed;
  const label = (o: OrderDTO) => {
    if (o.fulfilmentStatus === "CANCELLED") return irnActive(irnFor(o, gsp).live) ? "Cancelled, IRN active" : "Cancelled";
    if (o.billedOutside) return "Outside app";
    const r = irnFor(o, gsp).shown;
    return r ? irnLabel(r) : o.posBill ? "POS" : o.einvExportedAt ? "JSON exported" : "In app";
  };

  async function submit() {
    if (!sel) return;
    setBusy(true); setErr(null);
    try {
      await api.reverseBill(sel.id, { reason, returnToPending: back && !sel.posBill, reuseNumber: reuse && canReuse, confirm: confirm.trim(), force: active && force });
      setSelId(null);
      await onDone(`${sel.invoiceNumber} ${back ? "returned to Pending" : "cancelled"}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not cancel"); }
    setBusy(false);
  }

  // Opens directly under the tapped bill.
  const detail = sel && (
    <div className="grid items-start gap-3 bg-accent/10 px-3 pb-3 lg:grid-cols-2">
      {!sel.billedOutside && (
        <IrnPanel key={sel.id} order={sel} gstin={data.outlets.find((x) => x.id === sel.outletId)?.gstNumber ?? null}
          list={gsp} loadError={gspError} isAdmin={isAdmin} onChanged={loadGsp} />
      )}
      {!isAdmin && sel.billedOutside && <div className="card p-4 text-sm text-muted-foreground">Written outside the app: no e-invoice here.</div>}
      {isAdmin && (
        <div className="card space-y-3 p-4">
          <div className="text-xs font-semibold tracking-widest text-muted-foreground">CANCEL OR CORRECT</div>
          {sel.fulfilmentStatus === "CANCELLED" ? (
            <p className="text-sm">{sel.invoiceNumber} · {sel.outletName} is already cancelled.</p>
          ) : (
            <>
              <p className="font-mono text-sm font-bold">{sel.invoiceNumber} · {sel.outletName}</p>
              <div className="text-xs text-muted-foreground">Reason (kept in the audit log)</div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Reason">
                {REASONS.map((r) => (<button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`btn h-8 px-3 text-xs ${reason === r ? "btn-primary" : "btn-secondary"}`}>{r}</button>))}
              </div>
              <label className="flex items-start justify-between gap-3 text-sm"><span><b>Return order to Pending</b><br /><span className="text-xs text-muted-foreground">Stock goes back and the order can be billed again.</span></span>
                <input type="checkbox" role="switch" checked={back && !sel.posBill} disabled={sel.posBill} onChange={(e) => setBack(e.target.checked)} aria-label="Return order to Pending" /></label>
              <label className="flex items-start justify-between gap-3 text-sm"><span><b>Reuse this invoice number</b><br /><span className="text-xs text-muted-foreground">{reuseBlock}</span></span>
                <input type="checkbox" role="switch" checked={reuse && canReuse} disabled={!canReuse} onChange={(e) => setReuse(e.target.checked)} aria-label="Reuse this invoice number" /></label>
              <div><label className="label" htmlFor="cfm">Type {sel.invoiceNumber} to confirm</label><input id="cfm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={sel.invoiceNumber ?? ""} /></div>
              {active && (
                <label className="flex items-start justify-between gap-3 text-sm"><span><b>Cancel in the app anyway</b><br /><span className="text-xs text-muted-foreground">This bill has an IRN on the portal. Cancel the IRN above first. Tick this only if the portal no longer allows it: the IRN stays active there, so ask your CA about a credit note.</span></span>
                  <input type="checkbox" role="switch" checked={force} onChange={(e) => setForce(e.target.checked)} aria-label="Cancel in the app anyway" /></label>
              )}
              {err && <Alert kind="error">{err}</Alert>}
              <button type="button" className="btn btn-primary w-full" disabled={busy || confirm.trim() !== sel.invoiceNumber || (active && !force)} onClick={() => void submit()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{back && !sel.posBill ? "Cancel and return to Pending" : "Cancel invoice"}
              </button>
            </>
          )}
          <p className="text-xs text-muted-foreground">Every cancel records who did it, when and why. Admin only.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="card px-4 py-3"><div className="text-xs text-muted-foreground">Next invoice number</div><div className="text-xl font-bold text-accent">{series?.next ? `${series.prefix} ${series.reusable[0] ?? series.next}` : "Not set"}</div></div>
        <div className="card px-4 py-3"><div className="text-xs text-muted-foreground">Numbers waiting to be reused</div><div className="text-xl font-bold">{series?.reusable.length ?? 0}</div></div>
        {isAdmin && <button type="button" className="btn btn-secondary self-center" onClick={() => setShowSetup(true)}>E-invoice JSON, numbering &amp; details</button>}
      </div>

      {dlErr && <Alert kind="error">{dlErr}</Alert>}
      <div id="invoice-list" className="card min-w-0 scroll-mt-20">
        {list.length === 0 ? <EmptyState>No invoices yet.</EmptyState> : (
          <div className="divide-y divide-border">
            <div className="hidden grid-cols-[1fr_2fr_1fr_1fr_auto] gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground sm:grid"><div>Invoice</div><div>Outlet</div><div>Amount</div><div>Status</div><div className="w-[170px]">Actions</div></div>
            {shown.map((o) => {
              const inApp = !o.billedOutside && o.fulfilmentStatus !== "CANCELLED";
              return (
                <div key={o.id}>
                  <div id={`inv-${o.id}`} className={`scroll-mt-20 flex flex-col gap-2 px-3 py-3 text-sm sm:grid sm:grid-cols-[1fr_2fr_1fr_1fr_auto] sm:items-center sm:gap-2 sm:py-2 ${sel?.id === o.id ? "bg-accent/10" : ""}`}>
                    <button type="button" onClick={() => toggle(o.id)} aria-expanded={sel?.id === o.id} className="focus-ring flex min-w-0 flex-col gap-1 text-left sm:col-span-4 sm:grid sm:grid-cols-[1fr_2fr_1fr_1fr] sm:gap-2" aria-label={`Select ${o.invoiceNumber}`}>
                      <span className="flex items-baseline justify-between gap-2 sm:block"><span className="font-mono font-bold">{o.invoiceNumber}</span><span className="font-bold sm:hidden">{formatMoney(o.totalAmount)}</span></span>
                      <span className="truncate">{o.outletName}</span>
                      <span className="hidden sm:block">{formatMoney(o.totalAmount)}</span>
                      <span className="text-xs font-semibold uppercase text-muted-foreground sm:text-foreground">{label(o)}</span>
                    </button>
                    <div className="flex gap-2 sm:w-[170px] sm:gap-1">
                      {inApp && <button type="button" className="btn btn-secondary h-10 flex-1 !px-2 text-xs sm:h-8 sm:flex-none" title="Print the invoice"
                        onClick={() => { setDlErr(null); api.printInvoice(o.id).catch((e) => setDlErr(`${o.invoiceNumber}: ${e instanceof Error ? e.message : "Could not print"}`)); }}>Print invoice</button>}
                      {inApp && isAdmin && <button type="button" className="btn btn-secondary h-10 flex-1 !px-2 text-xs sm:h-8 sm:flex-none" title="E-invoice JSON for this bill"
                        onClick={() => { setDlErr(null); api.downloadEinvoiceForBill(o.id).catch((e) => setDlErr(`${o.invoiceNumber}: ${e instanceof Error ? e.message : "Could not make the JSON"}`)); }}>JSON</button>}
                      {inApp && <button type="button" className="btn btn-secondary h-10 flex-1 !px-2 text-xs sm:hidden" onClick={() => toggle(o.id)}>{isAdmin ? "IRN / cancel" : "IRN"}</button>}
                    </div>
                  </div>
                {sel?.id === o.id && detail}
                </div>
              );
            })}
            {pages > 1 && (
              <nav aria-label="Invoice pages" className="flex items-center justify-between gap-2 px-3 py-3">
                <button type="button" className="btn btn-secondary h-10 text-xs" disabled={at === 0} onClick={() => turn(at - 1)}>Previous</button>
                <span className="text-xs text-muted-foreground">{at * PAGE_SIZE + 1}–{at * PAGE_SIZE + shown.length} of {list.length} · page {at + 1} of {pages}</span>
                <button type="button" className="btn btn-secondary h-10 text-xs" disabled={at >= pages - 1} onClick={() => turn(at + 1)}>Next</button>
              </nav>
            )}
          </div>
        )}
      </div>

      <Modal open={showSetup} title="E-invoice JSON, numbering & details" onClose={() => setShowSetup(false)}>{showSetup && <EinvoicePanel />}</Modal>
    </div>
  );
}
