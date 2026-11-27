import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { loadInvoiceView } from "@/lib/invoice-view";
import { renderInvoicePdf } from "@/lib/invoice-pdf";

export const dynamic = "force-dynamic";

/** The A5 tax invoice as a real PDF file, named after the invoice number (MTR 312 -> MTR-312.pdf). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin", "stock"]);
    const { id } = await params;
    const v = await loadInvoiceView(id);
    const pdf = renderInvoicePdf(v);
    const name = `${v.invoiceNumber.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
