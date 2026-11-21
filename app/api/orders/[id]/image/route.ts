import { errorResponse, HttpError } from "@/lib/api";
import { authorize, ALL_ROLES } from "@/lib/auth";
import { loadInvoiceView } from "@/lib/invoice-view";
import { invoiceLayout } from "@/lib/invoice-pdf";

export const dynamic = "force-dynamic";

/**
 * Drawing instructions for the A5 tax invoice; the browser paints them on a canvas and saves a PNG
 * named after the invoice number. Open to every role — an agent only gets their own bills.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const { id } = await params;
    const v = await loadInvoiceView(id);
    if (user.role === "agent" && v.inv.staffId !== user.id) throw new HttpError(404, "Order not found");
    const name = v.invoiceNumber.replace(/[^A-Za-z0-9]+/g, "-");
    return Response.json({ name, ...invoiceLayout(v) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
