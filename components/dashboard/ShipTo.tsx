"use client";

import { STATES, HOME_STATE } from "@/lib/gst";
import type { ShipToInput } from "@/lib/types";

export interface ShipToForm { on: boolean; name: string; address: string; city: string; pincode: string; state: string }
export const emptyShipTo = (): ShipToForm => ({ on: false, name: "", address: "", city: "", pincode: "", state: HOME_STATE });

/** The ship-to block for the API, or undefined when the goods go to the buyer's own address. */
export function shipToInput(f: ShipToForm): ShipToInput | undefined {
  return f.on ? { name: f.name.trim() || undefined, address: f.address.trim(), city: f.city.trim(), pincode: f.pincode.trim(), state: f.state } : undefined;
}
/** True when ship-to is switched on but not filled in properly. */
export const shipToIncomplete = (f: ShipToForm) => f.on && (!f.address.trim() || f.city.trim().length < 3 || !/^[0-9]{6}$/.test(f.pincode.trim()));

/** "Ship to a different address" — optional delivery address; its state becomes the place of supply. */
export function ShipToFields({ value, onChange, idPrefix }: { value: ShipToForm; onChange: (v: ShipToForm) => void; idPrefix: string }) {
  const set = (patch: Partial<ShipToForm>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={value.on} onChange={(e) => set({ on: e.target.checked })} /> Ship to a different address
      </label>
      {value.on && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div><label className="label" htmlFor={`${idPrefix}-sn`}>Ship to name (optional)</label><input id={`${idPrefix}-sn`} className="input" value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Same as the buyer" /></div>
          <div><label className="label" htmlFor={`${idPrefix}-sa`}>Address</label><input id={`${idPrefix}-sa`} className="input" value={value.address} onChange={(e) => set({ address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor={`${idPrefix}-sc`}>City</label><input id={`${idPrefix}-sc`} className="input" value={value.city} onChange={(e) => set({ city: e.target.value })} /></div>
            <div><label className="label" htmlFor={`${idPrefix}-sp`}>Pincode</label><input id={`${idPrefix}-sp`} className="input" inputMode="numeric" value={value.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></div>
          </div>
          <div><label className="label" htmlFor={`${idPrefix}-ss`}>State</label>
            <select id={`${idPrefix}-ss`} className="input" value={value.state} onChange={(e) => set({ state: e.target.value })}>{STATES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}</select></div>
          <p className="text-xs text-muted-foreground">The delivery state becomes the place of supply ({value.state === HOME_STATE ? "CGST + SGST" : "IGST"}).</p>
        </div>
      )}
    </div>
  );
}
