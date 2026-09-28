import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import type { ApiError } from "./types";

/**
 * Prisma's interactive-transaction default (5s) was tuned for a local/direct connection.
 * Production talks to Supabase over the pooler with real network latency on every round
 * trip inside the transaction, so a normal-sized order dispatch can legitimately take a
 * few seconds longer than that and hit P2028 ("Transaction already closed") even though
 * nothing is actually wrong. Every non-bulk transaction in the app uses this instead; the
 * bulk-upload routes (up to 500 rows) set their own, larger timeout.
 */
export const TRANSACTION_TIMEOUT_MS = 20_000;

/** Thrown inside handlers/transactions to produce a specific HTTP error response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function parseBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function errorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request";
    return NextResponse.json({ error: message, details: err.flatten() }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
    const message = target.includes("username") ? "That username is already taken" : "A record with that value already exists";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  // Last line of defence: the database CHECK constraint that keeps stock at or above zero.
  if (err instanceof Error && err.message.includes("Product_stockQty_nonnegative")) {
    return NextResponse.json({ error: "Stock can't go below zero" }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Quotes a field only when it needs it (contains a comma, quote or newline) — keeps plain numbers and names readable. */
function csvField(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a CSV document (header row + data rows) as one string, CRLF-terminated per row. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** A downloadable CSV response, matching the attachment style of GET /api/backup. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
