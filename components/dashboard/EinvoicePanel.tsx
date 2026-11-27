"use client";

import type { TaxMode } from "@/lib/gst";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Save } from "lucide-react";
import type { EinvoiceReportDTO, EinvoiceSetupDTO, InvoiceSeriesDTO } from "@/lib/types";
import { api } from "./api-client";
import { Alert } from "./ui";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Admin tools for GST invoices made in the app: the MTR number series, the product/outlet details
 * the e-invoice needs, and the e-invoice JSON export (one bill or many, for the IRP bulk upload). The
 * export is the fallback: normally a bill is filed from its invoice (see IrnPanel).
 */
export function EinvoicePanel() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <SeriesBlock />
      <ExportBlock />
      <SetupBlock />
    </div>
  );
}

function SeriesBlock() {
  const [series, setSeries] = useState<InvoiceSeriesDTO | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    api.getInvoiceSeries().then((s) => { setSeries(s); setValue(s.next ? String(s.next) : ""); }).catch((e) => setNote({ kind: "error", text: msg(e, "Could not load") }));
  }, []);

  async function save() {
    setBusy(true); setNote(null);
    try {
      const s = await api.setInvoiceSeries(Number.parseInt(value, 10));
      setSeries(s);
      setNote({ kind: "success", text: `Next invoice will be ${s.prefix} ${s.next}` });
    } catch (e) { setNote({ kind: "error", text: msg(e, "Could not save") }); }
    setBusy(false);
  }

  return (
    <section className="card space-y-3 p-5">
      <h3 className="font-semibold">Invoice numbering</h3>
      <p className="text-xs text-muted-foreground">
        Bills made in the app take the next number automatically. Enter the starting number once; you can raise it later, never below a number already used.
        {series && series.highestUsed > 0 && <> Highest used so far: {series.prefix} {series.highestUsed}.</>}
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label" htmlFor="series-next">Next number ({series?.prefix ?? "MTR"})</label>
          <input id="series-next" className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 312" />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || !value} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
      </div>
      {note && <Alert kind={note.kind}>{note.text}</Alert>}
    </section>
  );
}

function ExportBlock() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [onlyNew, setOnlyNew] = useState(true);
  const [report, setReport] = useState<EinvoiceReportDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const q = { from, to, ...(onlyNew ? { only: "new" as const } : {}) };

  async function check() {
    setBusy(true); setNote(null);
    try { setReport(await api.einvoiceReport(q)); } catch (e) { setNote({ kind: "error", text: msg(e, "Could not check") }); }
    setBusy(false);
  }
  async function download() {
    setBusy(true); setNote(null);
    try {
      const blocked = await api.downloadEinvoiceJson(q);
      setNote({ kind: "success", text: blocked > 0 ? `Downloaded. ${blocked} bill(s) were left out — see the check list.` : "Downloaded." });
      setReport(await api.einvoiceReport(q));
    } catch (e) { setNote({ kind: "error", text: msg(e, "Could not download") }); }
    setBusy(false);
  }

  return (
    <section className="card space-y-3 p-5">
      <h3 className="font-semibold">E-invoice JSON</h3>
      <p className="text-xs text-muted-foreground">
        Backup for when direct filing is not working: one file for the bills in the date range, for the e-invoice portal's bulk upload. Bills written outside
        the app, cancelled bills, bills already filed from the app and outlets without a GSTIN are never included.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="ei-from">From</label><input id="ei-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label" htmlFor="ei-to">To</label><input id="ei-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Only bills not exported before</label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => void check()}>Check what's ready</button>
        <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void download()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download JSON
        </button>
      </div>
      {note && <Alert kind={note.kind}>{note.text}</Alert>}
      {report && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{report.ready} ready · {report.blocked} blocked{report.notApplicable > 0 ? ` · ${report.notApplicable} B2C (no e-invoice needed)` : ""}</p>
          {report.rows.filter((r) => !r.ready || r.warnings.length > 0).map((r) => (
            <div key={r.invoiceNumber} className="rounded-lg bg-secondary px-3 py-2">
              <p className="font-mono font-semibold">{r.invoiceNumber} {r.ready ? "" : "— blocked"}</p>
              {r.errors.map((x) => <p key={x} className="text-destructive text-xs">{x}</p>)}
              {r.warnings.map((x) => <p key={x} className="text-xs text-muted-foreground">{x}</p>)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** One grid for the header and every product row on wider screens; phones stack with a label per field. */
const PRODUCT_COLS = "md:grid md:grid-cols-[minmax(0,1.6fr)_1.2fr_.8fr_.7fr_.8fr_1.3fr] md:items-center md:gap-2";

function SetupBlock() {
  const [data, setData] = useState<EinvoiceSetupDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [prod, setProd] = useState<Record<string, { hsn: string; mrp: string; rate: string; uqc: string; tax: TaxMode }>>({});
  const [out, setOut] = useState<Record<string, { pin: string; city: string }>>({});
  const [onlyMissing, setOnlyMissing] = useState(true);

  const load = useCallback(async () => {
    const d = await api.getEinvoiceSetup();
    setData(d);
    setProd(Object.fromEntries(d.products.map((p) => [p.id, { hsn: p.hsnCode ?? "", mrp: p.mrp == null ? "" : String(p.mrp), rate: String(p.gstRate), uqc: p.uqc, tax: p.taxMode }])));
    setOut(Object.fromEntries(d.outlets.map((o) => [o.id, { pin: o.pincode ?? "", city: o.city ?? "" }])));
  }, []);
  useEffect(() => { load().catch((e) => setNote({ kind: "error", text: msg(e, "Could not load") })); }, [load]);

  const outlets = useMemo(() => (data?.outlets ?? []).filter((o) => !onlyMissing || !o.pincode || !o.city), [data, onlyMissing]);

  async function save() {
    if (!data) return;
    setBusy(true); setNote(null);
    try {
      // Send only what was changed: saving every product and outlet at once could run past the database time limit.
      const prodChanged = data.products.filter((p) => {
        const x = prod[p.id];
        return x.hsn.trim() !== (p.hsnCode ?? "") || x.mrp.trim() !== (p.mrp == null ? "" : String(p.mrp)) || Number(x.rate) !== p.gstRate || x.uqc !== p.uqc || x.tax !== p.taxMode;
      });
      const outChanged = data.outlets.filter((o) => out[o.id].pin.trim() !== (o.pincode ?? "") || out[o.id].city.trim() !== (o.city ?? ""));
      if (prodChanged.length === 0 && outChanged.length === 0) { setNote({ kind: "success", text: "Nothing changed" }); setBusy(false); return; }
      const d = await api.saveEinvoiceSetup({
        products: prodChanged.map((p) => ({ id: p.id, hsnCode: prod[p.id].hsn.trim() || null, mrp: prod[p.id].mrp.trim() === "" ? null : Number(prod[p.id].mrp), gstRate: Number(prod[p.id].rate), uqc: prod[p.id].uqc, taxMode: prod[p.id].tax })),
        outlets: outChanged.map((o) => ({ id: o.id, pincode: out[o.id].pin.trim() || null, city: out[o.id].city.trim() || null })),
      });
      setData(d);
      setNote({ kind: "success", text: "Saved" });
    } catch (e) { setNote({ kind: "error", text: msg(e, "Could not save") }); }
    setBusy(false);
  }

  if (!data) return <p className="card p-5 text-sm text-muted-foreground lg:col-span-2">{note ? note.text : "Loading set-up…"}</p>;
  return (
    <section className="card space-y-3 p-5 lg:col-span-2">
      <h3 className="font-semibold">Details the e-invoice needs</h3>
      <p className="text-xs text-muted-foreground">HSN, MRP and tax type for each product. <b>Inclusive</b>: the price already has GST. <b>Exclusive</b>: GST is added on top of the price. <b>On MRP</b>: the price has GST, and tax is worked on the MRP. Also pincode and city for each outlet with a GSTIN.</p>
      <div className="space-y-2">
        <div aria-hidden className={`hidden px-2 text-xs font-semibold text-muted-foreground ${PRODUCT_COLS}`}>
          <span>Product</span><span>HSN</span><span>MRP</span><span>GST %</span><span>Unit</span><span>Tax type</span>
        </div>
        {data.products.map((p) => (
          <div key={p.id} className={`rounded-lg bg-secondary p-2 ${PRODUCT_COLS}`}>
            <p className="min-w-0 break-words text-sm font-medium">{p.name}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 md:contents">
              <label className="block min-w-0"><span className="label md:sr-only">HSN</span>
                <input className="input" aria-label={`${p.name} HSN`} placeholder="HSN" value={prod[p.id]?.hsn ?? ""} onChange={(e) => setProd({ ...prod, [p.id]: { ...prod[p.id], hsn: e.target.value } })} /></label>
              <label className="block min-w-0"><span className="label md:sr-only">MRP</span>
                <input className="input" aria-label={`${p.name} MRP`} placeholder="MRP" inputMode="decimal" value={prod[p.id]?.mrp ?? ""} onChange={(e) => setProd({ ...prod, [p.id]: { ...prod[p.id], mrp: e.target.value } })} /></label>
              <label className="block min-w-0"><span className="label md:sr-only">GST %</span>
                <input className="input" aria-label={`${p.name} GST %`} placeholder="GST %" inputMode="decimal" value={prod[p.id]?.rate ?? ""} onChange={(e) => setProd({ ...prod, [p.id]: { ...prod[p.id], rate: e.target.value } })} /></label>
              <label className="block min-w-0"><span className="label md:sr-only">Unit</span>
                <input className="input" aria-label={`${p.name} unit`} placeholder="Unit" value={prod[p.id]?.uqc ?? ""} onChange={(e) => setProd({ ...prod, [p.id]: { ...prod[p.id], uqc: e.target.value } })} /></label>
              <label className="col-span-2 block min-w-0 md:col-span-1"><span className="label md:sr-only">Tax type</span>
                <select className="input" aria-label={`${p.name} tax type`} value={prod[p.id]?.tax ?? "MRP"} onChange={(e) => setProd({ ...prod, [p.id]: { ...prod[p.id], tax: e.target.value as TaxMode } })}>
                  <option value="INCLUSIVE">Inclusive</option>
                  <option value="EXCLUSIVE">Exclusive</option>
                  <option value="MRP">On MRP</option>
                </select></label>
            </div>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Show only outlets missing pincode or city ({outlets.length})</label>
      <div className="space-y-2">
        {outlets.map((o) => (
          <div key={o.id} className="rounded-lg bg-secondary p-2">
            <p className="text-sm font-medium">{o.name} <span className="font-mono text-xs text-muted-foreground">{o.gstNumber}</span></p>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <input className="input" aria-label={`${o.name} pincode`} placeholder="Pincode" inputMode="numeric" value={out[o.id]?.pin ?? ""} onChange={(e) => setOut({ ...out, [o.id]: { ...out[o.id], pin: e.target.value.replace(/\D/g, "").slice(0, 6) } })} />
              <input className="input" aria-label={`${o.name} city`} placeholder="City" value={out[o.id]?.city ?? ""} onChange={(e) => setOut({ ...out, [o.id]: { ...out[o.id], city: e.target.value } })} />
            </div>
          </div>
        ))}
      </div>
      {note && <Alert kind={note.kind}>{note.text}</Alert>}
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => void save()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save details
      </button>
    </section>
  );
}
