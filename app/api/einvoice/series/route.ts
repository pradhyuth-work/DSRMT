import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { setInvoiceSeriesSchema } from "@/lib/validation";
import { highestUsed, readSeries, setNextNumber } from "@/lib/invoice-series";
import type { InvoiceSeriesDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

async function state(tx: Parameters<typeof readSeries>[0]): Promise<InvoiceSeriesDTO> {
  const s = await readSeries(tx);
  return { prefix: s.prefix, next: s.next, reusable: s.reusable, highestUsed: await highestUsed(tx, s.prefix) };
}

/** The in-app invoice number series (MTR). Admin only — Billing mode (the bill form that shows the next number) is admin-only. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    return NextResponse.json(await state(prisma));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Sets the next number to hand out — also the one-time starting number. Never lower than a used one. */
export async function PATCH(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { next } = await parseBody(req, setInvoiceSeriesSchema);
    const body = await prisma.$transaction(async (tx) => {
      await setNextNumber(tx, next);
      return state(tx);
    }, { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
