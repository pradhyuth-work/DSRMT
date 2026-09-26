import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import type { ApiError } from "./types";

/** Thrown inside handlers/transactions to produce a specific HTTP error response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function parseBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function errorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request";
    return NextResponse.json({ error: message, details: err.flatten() }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
    const message = target.includes("username") ? "That username is already taken" : "A record with that value already exists";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  // Last line of defence: the database CHECK constraint that keeps stock at or above zero.
  if (err instanceof Error && err.message.includes("Product_stockQty_nonnegative")) {
    return NextResponse.json({ error: "Stock can't go below zero" }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
