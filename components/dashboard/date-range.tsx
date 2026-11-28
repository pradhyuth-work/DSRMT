"use client";

import { RangePicker } from "./RangePicker";

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

/** A small date-range filter: quick presets plus a single-calendar range picker. */
export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  function applyPreset(days: (typeof PRESETS)[number]["days"]) {
    if (days === "all") return onChange({});
    // Today's date in India: the UTC date is still yesterday until 5:30 am.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const to = endOfDayIso(today);
    if (days === "month") return onChange({ from: startOfDayIso(`${today.slice(0, 7)}-01`), to });
    const from = new Date(`${today}T00:00:00.000Z`);
    from.setUTCDate(from.getUTCDate() - days);
    return onChange({ from: startOfDayIso(from.toISOString().slice(0, 10)), to });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => applyPreset(p.days)}>
            {p.label}
          </button>
        ))}
      </div>
      <RangePicker
        className="w-auto max-w-full"
        from={toDateInput(value.from)}
        to={toDateInput(value.to)}
        onChange={(from, to) => onChange({ from: startOfDayIso(from), to: endOfDayIso(to) })}
      />
    </div>
  );
}
