"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// Days are handled as "yyyy-mm-dd" strings and stepped in UTC, so no time zone can shift them.
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
/** Same day of another month, held back to that month's last day (31 Jan + 1 → 28 Feb). */
const addMonths = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))));
};
const show = (day: string) => day.split("-").reverse().join("-");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * One calendar for a from–to range: the first tap picks the start, the second the end (either order;
 * the same day twice is a one-day range). Nothing changes until both are picked.
 */
export function RangePicker({
  id,
  from,
  to,
  onChange,
  placeholder = "All dates",
  className = "",
}: {
  id?: string;
  /** "yyyy-mm-dd", or "" for no bound */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** The day that holds keyboard focus; its month is the one on screen. */
  const [cursor, setCursor] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  function toggle() {
    if (open) return close(false);
    setStart(null);
    setHover(null);
    setCursor(to || from || localToday());
    focusDay.current = true;
    setOpen(true);
  }

  function pick(day: string) {
    if (!start) {
      setStart(day);
      setCursor(day);
      return;
    }
    const [a, b] = day < start ? [day, start] : [start, day];
    close(true);
    onChange(a, b);
  }

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    const pop = popRef.current;
    if (!t || !pop) return;
    const gap = 6;
    const edge = 8;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const h = pop.offsetHeight;
    let top = t.bottom + gap;
    if (top + h > vh - edge) top = t.top - gap - h >= edge ? t.top - gap - h : Math.max(edge, vh - edge - h);
    const left = Math.max(edge, Math.min(t.left, vw - edge - pop.offsetWidth));
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, cursor, place]);

  useLayoutEffect(() => {
    if (!open || !pos || !focusDay.current) return;
    focusDay.current = false;
    popRef.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus({ preventScroll: true });
  }, [open, pos, cursor]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!popRef.current?.contains(el) && !triggerRef.current?.contains(el)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return close(true);
    }
    if (!(e.target as HTMLElement).dataset.day) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const next = step[e.key] ? addDays(cursor, step[e.key]) : e.key === "PageUp" ? addMonths(cursor, -1) : e.key === "PageDown" ? addMonths(cursor, 1) : null;
    if (!next) return;
    e.preventDefault();
    focusDay.current = true;
    setCursor(next);
    setHover(next);
  }

  const view = cursor || localToday();
  const year = Number(view.slice(0, 4));
  const month = Number(view.slice(5, 7));
  const first = `${view.slice(0, 7)}-01`;
  const lead = (utc(first).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  const now = Number(localToday().slice(0, 4));
  const firstYear = Math.min(year, now - 8);
  const years = Array.from({ length: Math.max(year, now + 2) - firstYear + 1 }, (_, i) => firstYear + i);

  // What to shade: the range being picked (previewed up to the hovered day), else the current one.
  const other = start ? (hover ?? start) : "";
  const lo = start ? (other < start ? other : start) : from;
  const hi = start ? (other < start ? start : other) : to;

  const label = from && to ? (from === to ? show(from) : `${show(from)} – ${show(to)}`) : from ? `From ${show(from)}` : to ? `Up to ${show(to)}` : placeholder;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`input flex items-center gap-2 py-1.5 text-left ${className}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range: ${label}`}
        onClick={toggle}
      >
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choose date range"
            onKeyDown={onKeyDown}
            style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="z-50 max-h-[calc(100vh-1rem)] w-[min(19rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-border bg-card p-3 text-foreground shadow-[var(--shadow-float)]"
          >
            <div className="mb-2 flex items-center gap-1.5">
              <button type="button" className="focus-ring rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Previous month" onClick={() => setCursor(addMonths(view, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <select className="input min-w-0 flex-1 px-2 py-1" aria-label="Month" value={month} onChange={(e) => setCursor(addMonths(view, Number(e.target.value) - month))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <select className="input w-auto px-2 py-1" aria-label="Year" value={year} onChange={(e) => setCursor(addMonths(view, (Number(e.target.value) - year) * 12))}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button type="button" className="focus-ring rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Next month" onClick={() => setCursor(addMonths(view, 1))}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <span key={d} className="py-1">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5" onPointerLeave={() => setHover(null)}>
              {Array.from({ length: lead }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {days.map((day) => {
                const end = day === lo || day === hi;
                const inside = !!lo && !!hi && day > lo && day < hi;
                return (
                  <button
                    key={day}
                    type="button"
                    data-day={day}
                    tabIndex={day === view ? 0 : -1}
                    aria-pressed={end || inside}
                    aria-label={show(day)}
                    onClick={() => pick(day)}
                    onPointerEnter={() => setHover(day)}
                    className={`focus-ring h-9 text-sm ${
                      end ? "rounded-lg bg-primary font-bold text-primary-foreground" : inside ? "bg-primary/20" : "rounded-lg hover:bg-secondary"
                    } ${day === localToday() && !end ? "font-bold underline underline-offset-4" : ""}`}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
              {/* Always six weeks tall, so the popup doesn't jump between months. */}
              {Array.from({ length: 42 - lead - count }, (_, i) => (
                <span key={`tail-${i}`} className="h-9" />
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
              {start ? `From ${show(start)} — now pick the end date` : "Pick the start date"}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
