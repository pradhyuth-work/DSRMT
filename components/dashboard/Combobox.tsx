"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * A searchable, type-to-filter dropdown — a drop-in replacement for a plain <select>
 * wherever the option list is long enough that typing beats scrolling (outlets, products,
 * staff, routes). Include a "— None —"-style entry with value="" in `options` yourself if
 * clearing the selection should be possible; this component doesn't add one on its own.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  id,
  emptyText = "No matches",
  disabled,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q));
  }, [options, query]);

  // Rendered through a portal (see below) so a scrollable ancestor — a bulk-upload grid,
  // a modal body — never clips the option list; position is tracked in viewport coordinates.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const MAX_DROPDOWN_HEIGHT = 272; // max-h-64 (256px) plus vertical padding
    const update = () => {
      const r = rootRef.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const openUpward = spaceBelow < MAX_DROPDOWN_HEIGHT && r.top > spaceBelow;
      setRect(
        openUpward
          ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width }
          : { top: r.bottom + 4, left: r.left, width: r.width },
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function pick(opt: ComboboxOption) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) pick(opt);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          id={id}
          className="input pr-8"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          value={open ? query : (selected?.label ?? "")}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open &&
        rect &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width }}
            className="z-50 max-h-64 overflow-auto rounded-xl border border-border bg-card py-1 shadow-[var(--shadow-float)]"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(opt)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                    opt.disabled ? "cursor-not-allowed text-muted-foreground/50" : i === highlight ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description && <span className="block truncate text-xs text-muted-foreground">{opt.description}</span>}
                  </span>
                  {opt.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
