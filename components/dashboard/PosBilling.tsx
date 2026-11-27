"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { OutletDTO } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { computeLine, splitTax, STATES, HOME_STATE, type TaxMode } from "@/lib/gst";
import { api } from "./api-client";
import { Alert } from "./ui";
import { ShipToFields, emptyShipTo, shipToIncomplete, shipToInput, type ShipToForm } from "./ShipTo";
import { Combobox } from "./Combobox";
import type { DashboardData } from "./Dashboard";

interface Row { productId: string; qty: string; mrp: string; price: string; mode: TaxMode }
const blank = (mode: TaxMode): Row => ({ productId: "", qty: "", mrp: "", price: "", mode });

const OPTIONS: { id: TaxMode; label: string; explain: string }[] = [
  { id: "EXCLUSIVE", label: "Exclusive", explain: "Price is before tax. The tax is added on top." },
  { id: "INCLUSIVE", label: "Inclusive", explain: "Price already has tax. Tax is taken out of it." },
  { id: "MRP", label: "Inclusive on MRP", explain: "Price has tax. Tax is worked from the MRP, as on the MTR bills." },
];

/** Admin-only POS: walk-in or new outlet, price typed by hand, tax option chosen per item. */
export default function PosBilling({ data, onDone, onError }: { data: DashboardData; onDone: (text: string) => Promise<void>; onError: (text: string) => void }) {
  const [existing, setExisting] = useState(true);
  const [outletId, setOutletId] = useState("");
  const [n, setN] = useState({ name: "", gstin: "", address: "", city: "", pincode: "" });
  const [pos, setPos] = useState(HOME_STATE);
  const [mode, setMode] = useState<TaxMode>("MRP");
  const [rows, setRows] = useState<Row[]>([blank("MRP")]);
  const [shipTo, setShipTo] = useState<ShipToForm>(emptyShipTo());
  const [busy, setBusy] = useState(false);

  const outlet: OutletDTO | undefined = data.outlets.find((o) => o.id === outletId);
  const gstin = (existing ? outlet?.gstNumber ?? "" : n.gstin).trim().toUpperCase();
  const gstinState = /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  const effPos = shipTo.on ? shipTo.state : gstinState ?? pos;
  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);

  const calc = rows.map((r) => {
    const p = productById.get(r.productId);
    const qty = Number.parseInt(r.qty, 10);
    const price = Number.parseFloat(r.price);
    const mrp = r.mrp.trim() === "" ? p?.mrp ?? null : Number.parseFloat(r.mrp);
    if (!p || !(qty > 0) || !Number.isFinite(price) || price < 0) return null;
    const c = computeLine(r.mode, price, qty, p.gstRate ?? 40, mrp ?? null);
    return c ? { ...c, rate: p.gstRate ?? 40 } : null;
  });
  const done = calc.filter((c): c is NonNullable<typeof c> => c !== null);
  const tax = done.reduce((s, c) => s + c.tax, 0);
  const total = Math.round(done.reduce((s, c) => s + c.gross, 0));
  // Tax broken down by GST rate (a bill can mix 40%, 5%, 18% items).
  const slabs = [...done.reduce((m, c) => m.set(c.rate, (m.get(c.rate) ?? 0) + c.tax), new Map<number, number>())].sort((a, b) => b[0] - a[0]);
  const anyRow = rows.some((r) => r.productId);
  const complete = rows.every((r, i) => !r.productId && !r.qty && !r.price || calc[i] !== null) && done.length > 0;
  const outletOk = existing ? !!outletId : n.name.trim().length > 0 && (gstin === "" || /^[0-9A-Z]{15}$/.test(gstin));

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickProduct = (i: number, productId: string) => {
    const p = productById.get(productId);
    setRow(i, { productId, mrp: p?.mrp ? String(p.mrp) : "", price: rows[i].price || (p ? String(p.unitPrice) : "") });
  };

  async function create() {
    setBusy(true);
    try {
      const items = rows.filter((r) => r.productId).map((r) => ({
        productId: r.productId, quantity: Number.parseInt(r.qty, 10), price: Number.parseFloat(r.price), taxMode: r.mode,
        mrp: r.mrp.trim() === "" ? null : Number.parseFloat(r.mrp),
      }));
      const billed = await api.posBill({
        ...(existing ? { outletId } : { newOutlet: { name: n.name.trim(), gstNumber: gstin || null, address: n.address.trim(), city: n.city.trim() || undefined, pincode: n.pincode.trim() || undefined } }),
        placeOfSupply: effPos, taxMode: mode, shipTo: shipToInput(shipTo), items,
      });
      setRows([blank(mode)]); setShipTo(emptyShipTo()); setOutletId(""); setN({ name: "", gstin: "", address: "", city: "", pincode: "" });
      await onDone(`POS bill ${billed.invoiceNumber} made for ${formatMoney(billed.totalAmount)}${existing ? "" : " — new outlet is pending review"}`);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not create the bill"); }
    setBusy(false);
  }

  const pending = data.outlets.filter((o) => o.pendingReview);
  async function approve(id: string) {
    try { await api.approveOutlet(id); await onDone("Outlet approved"); } catch (e) { onError(e instanceof Error ? e.message : "Could not approve"); }
  }

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold">POS billing</h2><p className="text-sm text-muted-foreground">Admin only. Walk-in or new outlet, price typed by you, tax option chosen per item.</p></div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="card min-w-0 flex-1 basis-[420px] space-y-4 p-4">
          <div className="flex gap-2">
            <button type="button" className={`btn h-9 text-sm ${existing ? "btn-primary" : "btn-secondary"}`} onClick={() => setExisting(true)}>Existing outlet</button>
            <button type="button" className={`btn h-9 text-sm ${!existing ? "btn-primary" : "btn-secondary"}`} onClick={() => setExisting(false)}>New outlet</button>
          </div>
          {existing ? (
            <div><label className="label" htmlFor="pos-outlet">Outlet</label>
              <Combobox id="pos-outlet" value={outletId} onChange={setOutletId} placeholder="Choose an outlet"
                options={data.outlets.map((o) => ({ value: o.id, label: o.name, description: o.gstNumber ?? "No GSTIN" }))} /></div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="n-name">Outlet name</label><input id="n-name" className="input" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
              <div><label className="label" htmlFor="n-gst">GSTIN (optional)</label><input id="n-gst" className="input" value={n.gstin} onChange={(e) => setN({ ...n, gstin: e.target.value.toUpperCase() })} maxLength={15} /></div>
              <div><label className="label" htmlFor="n-pin">Pincode</label><input id="n-pin" className="input" inputMode="numeric" value={n.pincode} onChange={(e) => setN({ ...n, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></div>
              <div><label className="label" htmlFor="n-city">City</label><input id="n-city" className="input" value={n.city} onChange={(e) => setN({ ...n, city: e.target.value })} /></div>
              <div><label className="label" htmlFor="n-addr">Address</label><input id="n-addr" className="input" value={n.address} onChange={(e) => setN({ ...n, address: e.target.value })} /></div>
              <p className="text-xs text-muted-foreground sm:col-span-2">A new outlet stays "pending review" until you approve it. No GSTIN means a B2C invoice with no IRN.</p>
            </div>
          )}
          <div>
            <label className="label" htmlFor="pos-state">Place of supply</label>
            {gstinState ? (
              <p className="text-sm">{STATES.find((s) => s.code === gstinState)?.name ?? gstinState} <span className="text-xs text-muted-foreground">(from the GSTIN)</span></p>
            ) : (
              <select id="pos-state" className="input" value={pos} onChange={(e) => setPos(e.target.value)}>{STATES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}</select>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{effPos === HOME_STATE ? "Karnataka: CGST + SGST." : "Outside Karnataka: IGST."}</p>
          </div>

          <ShipToFields idPrefix="pos" value={shipTo} onChange={setShipTo} />

          <div><div className="mb-1 text-xs font-semibold tracking-widest text-muted-foreground">TAX OPTION FOR ALL ITEMS <span className="font-normal normal-case tracking-normal">— or change it item by item below</span></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tax option">
              {OPTIONS.map((o) => (<button key={o.id} type="button" aria-pressed={rows.every((r) => r.mode === o.id)} onClick={() => { setMode(o.id); setRows(rows.map((r) => ({ ...r, mode: o.id }))); }} className={`btn h-9 text-sm ${rows.every((r) => r.mode === o.id) ? "btn-primary" : "btn-secondary"}`}>{o.label}</button>))}
            </div></div>

          <div className="space-y-2">
            <div className="hidden grid-cols-[2fr_1.1fr_.7fr_.9fr_.9fr_auto] gap-2 text-xs font-semibold text-muted-foreground sm:grid"><div>Item</div><div>Tax</div><div>Qty</div><div>MRP / pack</div><div>Your price / pack</div><div /></div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[2fr_1.1fr_.7fr_.9fr_.9fr_auto] sm:border-0 sm:p-0">
                <div className="col-span-2 sm:col-span-1"><Combobox value={r.productId} onChange={(v) => pickProduct(i, v)} ariaLabel="Item" placeholder="Choose item"
                  options={data.products.map((p) => ({ value: p.id, label: p.name, description: p.stockQty != null ? `${p.stockQty} in stock` : undefined }))} /></div>
                <select className="input" aria-label="Tax option" value={r.mode} onChange={(e) => setRow(i, { mode: e.target.value as TaxMode })}>
                  {OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.id === "MRP" ? "On MRP" : o.label}</option>)}
                </select>
                <input className="input" aria-label="Quantity" placeholder="Qty" inputMode="numeric" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value.replace(/\D/g, "") })} />
                <input className="input" aria-label="MRP" placeholder="MRP / pack" inputMode="decimal" value={r.mrp} onChange={(e) => setRow(i, { mrp: e.target.value })} disabled={r.mode !== "MRP"} />
                <input className="input" aria-label="Price" placeholder="Your price / pack" inputMode="decimal" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} />
                <button type="button" className="btn btn-secondary col-span-2 h-10 sm:col-span-1 sm:w-10 !px-0" aria-label="Remove item" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary h-9 text-sm" onClick={() => setRows([...rows, blank(mode)])}><Plus className="h-4 w-4" /> Add item</button>
          </div>
        </div>

        <div className="card w-full shrink-0 space-y-2 p-4 lg:w-80">
          <div className="text-xs font-semibold tracking-widest text-muted-foreground">WHAT THE BILL WILL SHOW</div>
          <p className="text-sm text-muted-foreground">Each item uses its own tax option. Tax is shown by GST rate.</p>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sub total</span><span>{formatMoney(total - tax)}</span></div>
          {slabs.length === 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">GST</span><span>{formatMoney(0)}</span></div>}
          {slabs.map(([rate, amt]) => {
            const x = splitTax(amt, effPos);
            return effPos === HOME_STATE ? (
              <div key={rate} className="space-y-1">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">CGST {rate / 2}%</span><span>{formatMoney(x.cgst)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">SGST {rate / 2}%</span><span>{formatMoney(x.sgst)}</span></div>
              </div>
            ) : (
              <div key={rate} className="flex justify-between text-sm"><span className="text-muted-foreground">IGST {rate}%</span><span>{formatMoney(x.igst)}</span></div>
            );
          })}
          <div className="flex justify-between border-t border-border pt-2 text-lg font-bold"><span>Total</span><span>{formatMoney(total)}</span></div>
          {anyRow && !complete && <Alert kind="warning">Fill quantity and price on every item{rows.some((r) => r.mode === "MRP") ? " (and MRP on MRP items)" : ""}.</Alert>}
          <button type="button" className="btn btn-primary w-full" disabled={busy || !complete || !outletOk || shipToIncomplete(shipTo)} onClick={() => void create()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create bill
          </button>
          <p className="text-xs text-muted-foreground">Makes the next MTR invoice, takes stock out and marks it handed over. Payment is collected under Payments.</p>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card space-y-2 p-4">
          <div className="text-xs font-semibold tracking-widest text-muted-foreground">OUTLETS PENDING REVIEW</div>
          {pending.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 text-sm"><span>{o.name} <span className="font-mono text-xs text-muted-foreground">{o.gstNumber ?? "No GSTIN"}</span></span>
              <button type="button" className="btn btn-secondary h-8 text-xs" onClick={() => void approve(o.id)}>Approve</button></div>
          ))}
        </div>
      )}
    </div>
  );
}
