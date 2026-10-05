import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { toggleAllSchemesSchema } from "@/lib/validation";

/**
 * The Stock master switch — flips schemeActive for every product at once without touching
 * any stored schemePrice, so turning it back on restores exactly what was active before.
 * Admin only, same as every other scheme edit.
 */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { active } = await parseBody(req, toggleAllSchemesSchema);
    const { count } = await prisma.product.updateMany({ data: { schemeActive: active } });
    return NextResponse.json({ count, active });
  } catch (err) {
    return errorResponse(err);
  }
}
