"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Banknote, CheckCircle2, FileText, Landmark, X, type LucideIcon } from "lucide-react";
import { PAYMENT_METHODS, type FulfilmentStatus, type InvoiceStatus, type PaymentMethod } from "@/lib/types";
import { DAYS_CRITICAL_THRESHOLD, DAYS_WARNING_THRESHOLD } from "@/lib/money";

type SelectableMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_ICON: Record<SelectableMethod, LucideIcon> = { CASH: Banknote, CHEQUE: FileText, NET_BANKING: Landmark };
const METHOD_LABEL: Record<SelectableMethod, string> = { CASH: "Cash", CHEQUE: "Cheque", NET_BANKING: "Net Banking" };

/** The CASH/CHEQUE/NET_BANKING picker used everywhere a payment method is recorded. UPI is
 * deliberately never offered here — it only ever appears read-only on historical payments. */
export function PaymentMethodPicker({
  value,
  onChange,
  size = "sm",
}: {
  value: PaymentMethod;
  onChange: (method: SelectableMethod) => void;
  /** "lg" for the big-tap agent/admin sale forms; "sm" for compact payment-collection forms. */
  size?: "sm" | "lg";
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PAYMENT_METHODS.map((m) => {
        const Icon = METHOD_ICON[m];
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`btn flex-col gap-1 text-xs ${size === "lg" ? "h-14 text-sm" : "py-2"} ${
              value === m ? "btn-primary" : "btn-secondary"
            }`}
          >
            <Icon className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
            {METHOD_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "lime",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "lime" | "gold" | "rose" | "teal";
}) {
  const tones = {
    lime: "bg-success text-success-foreground",
    gold: "bg-warning text-warning-foreground",
    rose: "bg-danger text-danger-foreground",
    teal: "bg-info text-info-foreground",
  } as const;
  return (
    <div className="app-rise card flex items-center gap-4 p-4">
      <div className={`rounded-lg p-2.5 ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-bold tracking-[-.03em]">{value}</p>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Portalled to document.body: any ancestor with a CSS animation/transition ending on a
  // non-"none" transform (e.g. the .app-enter entrance animation's `both` fill-mode) becomes
  // a containing block for `position: fixed` descendants, which would otherwise pin this
  // dialog to that ancestor's box — invisible off-screen on any tab taller than the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-primary/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="app-rise max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card shadow-[var(--shadow-float)] sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold tracking-[-.02em]">{title}</h2>
          <button onClick={onClose} className="focus-ring rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Alert({ kind, children }: { kind: "error" | "success" | "warning"; children: React.ReactNode }) {
  const styles = {
    error: "bg-danger/50 text-danger-foreground",
    success: "bg-success/50 text-success-foreground",
    warning: "bg-warning/50 text-warning-foreground",
  } as const;
  const Icon = kind === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium ${styles[kind]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const styles: Record<InvoiceStatus, string> = {
    PAID: "bg-success text-success-foreground",
    PARTIAL: "bg-warning text-warning-foreground",
    UNPAID: "bg-danger text-danger-foreground",
  };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${styles[status]}`}>{status}</span>;
}

export function FulfilmentBadge({ status }: { status: FulfilmentStatus }) {
  const styles: Record<FulfilmentStatus, string> = {
    PENDING: "bg-info text-info-foreground",
    BILLED: "bg-warning text-warning-foreground",
    DISPATCHED: "bg-primary text-primary-foreground",
    CANCELLED: "bg-muted text-muted-foreground",
  };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${styles[status]}`}>{status}</span>;
}

/**
 * "Days of credit" indicator for an outstanding balance's age — plain text under
 * DAYS_WARNING_THRESHOLD, amber past it, bold red past DAYS_CRITICAL_THRESHOLD
 * (lib/money.ts). Those two numbers are defaults, not a business rule; change them there.
 */
export function DaysOutstandingBadge({ days }: { days: number }) {
  const style =
    days > DAYS_CRITICAL_THRESHOLD
      ? "font-bold text-danger-foreground"
      : days > DAYS_WARNING_THRESHOLD
        ? "font-semibold text-warning-foreground"
        : "text-muted-foreground";
  return <span className={`tabular-nums ${style}`}>{days} day{days === 1 ? "" : "s"}</span>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
