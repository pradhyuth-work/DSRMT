import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { restoreBackup, validateBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  /** Must be the word RESTORE, so a stray request can never wipe the database. */
  confirm: z.literal("RESTORE"),
  backup: z.unknown(),
});

/**
 * Replaces the ENTIRE database with the contents of a backup file made by GET /api/backup.
 * Admin only, all-or-nothing (one transaction: if anything fails, nothing changes).
 */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { backup } = await parseBody(req, schema);
    const file = validateBackup(backup);
    const result = await restoreBackup(file);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
