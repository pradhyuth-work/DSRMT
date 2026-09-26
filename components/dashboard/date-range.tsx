"use client";

import { Calendar } from "lucide-react";

/** Full ISO datetime strings (or undefined for "no bound"), ready to send to the API. */
export interface DateRange {
  from?: string;
  to?: string;
}

function toDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function startOfDayIso(dateInput: string): string {
  return `${dateInput}T00:00:00.000Z`;
}
function endOfDayIso(dateInput: string): string {
  return `${dateInput}T23:59:59.999Z`;
}

const PRESETS: { label: string; days: number | "month" | "all" }[] = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "This month", days: "month" },
  { label: "All time", days: "all" },
];

/** A small date-range filter: quick presets plus custom from/to date inputs. */
export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  function applyPreset(days: (typeof PRESETS)[number]["days"]) {
    if (days === "all") return onChange({});
    const now = new Date();
    const to = endOfDayIso(now.toISOString().slice(0, 10));
    if (days === "month") {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return onChange({ from: startOfDayIso(from.toISOString().slice(0, 10)), to });
    }
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - days);
    return onChange({ from: startOfDayIso(from.toISOString().slice(0, 10)), to });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => applyPreset(p.days)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <input
          type="date"
          className="input w-auto py-1.5 text-sm"
          value={toDateInput(value.from)}
          onChange={(e) => onChange({ ...value, from: e.target.value ? startOfDayIso(e.target.value) : undefined })}
          aria-label="From date"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          className="input w-auto py-1.5 text-sm"
          value={toDateInput(value.to)}
          onChange={(e) => onChange({ ...value, to: e.target.value ? endOfDayIso(e.target.value) : undefined })}
          aria-label="To date"
        />
      </div>
    </div>
  );
}
