import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { generateEinvoiceSchema } from "@/lib/validation";
import { generateEinvoice, toEInvoiceDTO } from "@/lib/einvoice-live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Generates the IRN (and, in the same call, the e-way bill when asked) for a billed invoice. Admin only.
 * A refusal by the portal is not an HTTP error: it is saved on the record and returned with status FAILED.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, generateEinvoiceSchema);
    return NextResponse.json(toEInvoiceDTO(await generateEinvoice(id, input.ewayBill, user.name)));
  } catch (err) {
    return errorResponse(err);
  }
}
