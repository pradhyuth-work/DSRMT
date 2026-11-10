import { errorResponse, HttpError } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { mtDsrQuerySchema } from "@/lib/validation";
import { buildMtDsr } from "@/lib/mt-dsr";
import { loadMtDsrInput, MtDsrRangeError } from "@/lib/mt-dsr-data";

export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Downloads the MT DSR workbook (WD DSR + FA-Outlet Wise Sale sheets) for an inclusive
 * period — ?from=…&to=… are both required. Admin only, like the other reports.
 * Products that have no column in the workbook are listed in the X-Unmapped-Products header.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to } = mtDsrQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    let input;
    try {
      input = await loadMtDsrInput(from, to);
    } catch (err) {
      if (err instanceof MtDsrRangeError) throw new HttpError(400, err.message);
      throw err;
    }
    const { bytes, unmappedProducts } = buildMtDsr(input);
    // A plain ArrayBuffer copy is a body type every runtime and TS lib version accepts.
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="MT_DSR_${input.from}_to_${input.to}.xlsx"`,
        "X-Unmapped-Products": encodeURIComponent(unmappedProducts.join(", ")),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
