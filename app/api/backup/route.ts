import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { buildBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one full backup. Downloads EVERY table in the database as a single JSON file (the list
 * comes from the Prisma data model, so new tables are included automatically) and can be put
 * back with POST /api/backup/restore. Admin only.
 *
 * The file includes staff password hashes so a restore brings the logins back. Treat it like
 * a password list: keep it private and do not email it around.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const backup = await buildBackup();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    return new Response(JSON.stringify(backup), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="dsrmt-backup-${stamp}.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
