import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { BILL_MEDIA_TYPES, MAX_BILL_BYTES, readBill } from "@/lib/bill-extract";
import type { BillExtractResponse } from "@/lib/types";

// Reading a bill takes a few seconds; the default function limit can be shorter than that.
export const maxDuration = 60;

/**
 * Reads an uploaded supplier bill (PDF or photo) and returns proposed inward lines. Admin only,
 * like the bulk receive it feeds. This route NEVER changes stock — the person reviews the
 * proposed lines in the inwarding grid and posts them through the normal bulk-receive route.
 */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Attach the bill as a PDF or photo");
    if (!(BILL_MEDIA_TYPES as readonly string[]).includes(file.type)) {
      throw new HttpError(400, "Upload the bill as a PDF, JPG, PNG or WebP");
    }
    if (file.size > MAX_BILL_BYTES) throw new HttpError(400, "That file is too large (4 MB max) — upload a smaller photo or a lighter PDF");

    const catalogue = (await prisma.product.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((p) => p.name);
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const reading = await readBill({ base64, mediaType: file.type }, catalogue);

    const supplierRef = [reading.supplierName, reading.invoiceNumber, reading.invoiceDate].filter(Boolean).join(" · ").slice(0, 120);

    // Guard against inwarding the same bill twice: look for an earlier receipt carrying this bill number.
    let duplicateOf: string | null = null;
    if (reading.invoiceNumber && reading.invoiceNumber.length >= 3) {
      const earlier = await prisma.stockMovement.findFirst({
        where: { type: "RECEIVE", supplierRef: { contains: reading.invoiceNumber, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { supplierRef: true, createdAt: true },
      });
      if (earlier) duplicateOf = `${earlier.supplierRef} (inwarded ${earlier.createdAt.toISOString().slice(0, 10)})`;
    }

    const body: BillExtractResponse = {
      supplierRef,
      lines: reading.lines.map((l) => ({ billText: l.billText, productName: l.productName, quantity: l.quantity, note: l.note })),
      warnings: reading.warnings,
      duplicateOf,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
