"use client";

import { BadgeCheck, type LucideIcon } from "lucide-react";

/** Small layout pieces shared by the Billing mode screens, so all four read as one desk. */

export function PageHead({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  const cut = title.lastIndexOf(" ");
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 py-2">
      <div className="min-w-0">
        <span className="bill-pill"><BadgeCheck className="h-4 w-4" aria-hidden /> GST billing</span>
        <h2 className="bill-title mt-3">{cut < 0 ? <span>{title}</span> : <>{title.slice(0, cut + 1)}<span>{title.slice(cut + 1)}</span></>}</h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
      </div>
      {children}
    </div>
  );
}

/** A row of headline figures: always one line, even on a phone. The accent one is shown in cyan. */
export function Tiles({ items }: { items: { label: string; value: React.ReactNode; accent?: boolean }[] }) {
  return (
    <dl className="grid auto-cols-fr grid-flow-col gap-2 border-y border-border py-4 text-center">
      {items.map((t) => (
        <div key={t.label} className="flex min-w-0 flex-col items-center">
          <dd className={`bill-figure order-1 truncate text-base tabular-nums min-[420px]:text-xl sm:text-3xl ${t.accent ? "alt" : ""}`}>{t.value}</dd>
          <div className={`bill-rule order-2 ${t.accent ? "alt" : ""}`} aria-hidden />
          <dt className="order-3 text-xs text-muted-foreground sm:text-sm">{t.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A glowing icon with a two-digit number in the corner: the head of a numbered card. */
export function CardMark({ step, icon: Icon }: { step: number; icon: LucideIcon }) {
  return (
    <div className="flex items-start justify-between">
      <span className="bill-icon"><Icon className="h-6 w-6" aria-hidden /></span>
      <span className="bill-num">{String(step).padStart(2, "0")}</span>
    </div>
  );
}

/** A card with a numbered title, for forms that are filled top to bottom. */
export function Panel({ step, title, icon, children }: { step: number; title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <CardMark step={step} icon={icon} />
      <h3 className="text-xl font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** One-of-several choice shown as underlined tabs. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <div role="group" aria-label={label} className="bill-tabs grid auto-cols-fr grid-flow-col">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className="focus-ring min-h-[44px] px-2 py-2 text-[13px] font-medium leading-tight text-muted-foreground transition-colors hover:text-foreground">
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TONES = {
  good: "bg-success text-success-foreground",
  warn: "bg-warning text-warning-foreground",
  bad: "bg-danger text-danger-foreground",
  plain: "bg-info text-info-foreground",
} as const;
export type Tone = keyof typeof TONES;

export function Chip({ tone = "plain", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`tag inline-flex shrink-0 whitespace-nowrap px-2 py-0.5 text-[10px] font-bold ${TONES[tone]}`}>{children}</span>;
}
