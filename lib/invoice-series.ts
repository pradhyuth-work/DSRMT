import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/api";

const PREFIX_KEY = "invoice_prefix";
const NEXT_KEY = "invoice_next";
const REUSE_KEY = "invoice_reuse";
export const DEFAULT_PREFIX = "MTR";

export interface SeriesState {
  prefix: string;
  /** Next number to hand out; null until the admin has entered the starting number once. */
  next: number | null;
  /** Numbers freed by a "reuse this number" cancel, handed out again before the counter moves on. */
  reusable: number[];
}

/** Printed number, e.g. "MTR 312". The IRP wants no spaces, so e-invoice JSON uses {@link irpDocNumber}. */
export const formatInvoiceNumber = (prefix: string, n: number) => `${prefix} ${n}`;
export const irpDocNumber = (printed: string) => printed.trim().replace(/\s+/g, "-");

export async function readSeries(tx: Prisma.TransactionClient): Promise<SeriesState> {
  const rows = await tx.appSetting.findMany({ where: { key: { in: [PREFIX_KEY, NEXT_KEY, REUSE_KEY] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const next = Number.parseInt(get(NEXT_KEY) ?? "", 10);
  let reusable: number[] = [];
  try {
    const parsed: unknown = JSON.parse(get(REUSE_KEY) ?? "[]");
    if (Array.isArray(parsed)) reusable = parsed.filter((n): n is number => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  } catch {
    reusable = [];
  }
  return { prefix: get(PREFIX_KEY) ?? DEFAULT_PREFIX, next: Number.isInteger(next) && next > 0 ? next : null, reusable };
}

/** Highest number already used under this prefix by any bill, however it was entered. */
export async function highestUsed(tx: Prisma.TransactionClient, prefix: string): Promise<number> {
  const rows = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: `${prefix} ` } },
    select: { invoiceNumber: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt((r.invoiceNumber ?? "").slice(prefix.length + 1), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * Admin sets the next number (also used for the very first, one-time entry). Refuses a number
 * that is already used or lower than one already used, so the series can never go backwards
 * or hand out a duplicate.
 */
export async function setNextNumber(tx: Prisma.TransactionClient, next: number): Promise<SeriesState> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice_series'))`;
  const { prefix } = await readSeries(tx);
  const used = await highestUsed(tx, prefix);
  if (next <= used) {
    throw new HttpError(409, `${prefix} ${used} is already used — the next number must be ${used + 1} or higher`);
  }
  await tx.appSetting.upsert({ where: { key: NEXT_KEY }, update: { value: String(next) }, create: { key: NEXT_KEY, value: String(next) } });
  await tx.appSetting.upsert({ where: { key: PREFIX_KEY }, update: {}, create: { key: PREFIX_KEY, value: prefix } });
  return { prefix, next, reusable: (await readSeries(tx)).reusable };
}

/** Hands out the next number inside the caller's transaction and advances the counter. */
export async function allocateNumber(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice_series'))`;
  const { prefix, next, reusable } = await readSeries(tx);
  if (reusable.length > 0) {
    const [first, ...rest] = reusable;
    await tx.appSetting.upsert({ where: { key: REUSE_KEY }, update: { value: JSON.stringify(rest) }, create: { key: REUSE_KEY, value: JSON.stringify(rest) } });
    return formatInvoiceNumber(prefix, first);
  }
  if (next === null) throw new HttpError(400, "Set the starting invoice number first (E-invoice & numbering)");
  const used = await highestUsed(tx, prefix);
  if (next <= used) throw new HttpError(409, `${prefix} ${used} is already used — raise the next number in E-invoice & numbering`);
  const printed = formatInvoiceNumber(prefix, next);
  await tx.appSetting.update({ where: { key: NEXT_KEY }, data: { value: String(next + 1) } });
  return printed;
}

/** Puts a freed number back in the pool (only ever for a number of this series that was never exported). */
export async function addReusable(tx: Prisma.TransactionClient, printed: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice_series'))`;
  const { prefix, reusable } = await readSeries(tx);
  if (!printed.startsWith(`${prefix} `)) throw new HttpError(400, `${printed} is not in the ${prefix} series, so it can't be reused`);
  const n = Number.parseInt(printed.slice(prefix.length + 1), 10);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${printed} is not a valid ${prefix} number`);
  const next = [...new Set([...reusable, n])].sort((a, b) => a - b);
  await tx.appSetting.upsert({ where: { key: REUSE_KEY }, update: { value: JSON.stringify(next) }, create: { key: REUSE_KEY, value: JSON.stringify(next) } });
}
