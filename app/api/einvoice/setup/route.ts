import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { einvoiceSetupSchema } from "@/lib/validation";
import type { TaxMode } from "@/lib/gst";
import type { EinvoiceSetupDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

async function load(): Promise<EinvoiceSetupDTO> {
  const [products, outlets] = await Promise.all([
    prisma.product.findMany({ orderBy: { productCode: "asc" } }),
    prisma.outlet.findMany({ where: { gstNumber: { not: null } }, orderBy: { name: "asc" } }),
  ]);
  return {
    products: products.map((p) => ({ id: p.id, name: p.name, unitPrice: p.unitPrice, hsnCode: p.hsnCode, gstRate: p.gstRate, mrp: p.mrp, uqc: p.uqc, taxMode: p.taxMode as TaxMode })),
    outlets: outlets.map((o) => ({ id: o.id, name: o.name, gstNumber: o.gstNumber ?? "", address: o.address, pincode: o.pincode, city: o.city })),
  };
}

/** Everything the e-invoice JSON needs that isn't on an order yet: HSN/MRP per product, pincode/city per GST outlet. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    return NextResponse.json(await load());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const input = await parseBody(req, einvoiceSetupSchema);
    await prisma.$transaction(async (tx) => {
      for (const p of input.products ?? []) {
        await tx.product.update({ where: { id: p.id }, data: { hsnCode: p.hsnCode, gstRate: p.gstRate, mrp: p.mrp, uqc: p.uqc, taxMode: p.taxMode } });
      }
      for (const o of input.outlets ?? []) {
        await tx.outlet.update({ where: { id: o.id }, data: { pincode: o.pincode, city: o.city } });
      }
    }, { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(await load());
  } catch (err) {
    return errorResponse(err);
  }
}
