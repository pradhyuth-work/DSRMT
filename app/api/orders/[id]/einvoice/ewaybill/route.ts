import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { ewayBillSchema } from "@/lib/validation";
import { retryEwayBill, toEInvoiceDTO } from "@/lib/einvoice-live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Makes (or retries) the e-way bill for an invoice that already has an IRN. Admin and stock. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin", "stock"]);
    const { id } = await params;
    const input = await parseBody(req, ewayBillSchema);
    return NextResponse.json(toEInvoiceDTO(await retryEwayBill(id, input)));
  } catch (err) {
    return errorResponse(err);
  }
}
