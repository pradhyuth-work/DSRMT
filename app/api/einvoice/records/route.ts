import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { gspConfig } from "@/lib/gstin-client";
import { toEInvoiceDTO } from "@/lib/einvoice-live";
import type { EInvoiceListDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Whether the GSP is set up (and in test or live mode), plus the latest IRN records. Admin only. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const rows = await prisma.eInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 2000 });
    const body: EInvoiceListDTO = { ...gspConfig(), records: rows.map(toEInvoiceDTO) };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
