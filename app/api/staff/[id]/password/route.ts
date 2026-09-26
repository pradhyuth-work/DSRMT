import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize, hashPassword, signToken } from "@/lib/auth";
import { resetPasswordSchema } from "@/lib/validation";
import type { ResetPasswordResponse } from "@/lib/types";

/**
 * Set or reset a password. Bumps tokenVersion so any existing sessions for that user end.
 * When admins reset their own password they get a fresh token back so they stay signed in.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await authorize(req, ["admin"]);
    const { id } = await params;
    const { password } = await parseBody(req, resetPasswordSchema);

    const target = await prisma.staff.findUnique({ where: { id }, select: { username: true } });
    if (!target) throw new HttpError(404, "User not found");
    if (!target.username) throw new HttpError(400, "Give this person a username before setting a password");

    const updated = await prisma.staff.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
      select: { id: true, role: true, tokenVersion: true },
    });

    const body: ResetPasswordResponse = id === me.id ? { token: signToken(updated) } : {};
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
