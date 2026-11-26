import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { cancelEinvoiceSchema } from "@/lib/validation";
import { cancelEinvoice, toEInvoiceDTO } from "@/lib/einvoice-live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cancels the e-way bill (if any) and the IRN on the government portal. Admin only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, cancelEinvoiceSchema);
    return NextResponse.json(toEInvoiceDTO(await cancelEinvoice(id, input.reason, input.remark, input.confirm)));
  } catch (err) {
    return errorResponse(err);
  }
}
