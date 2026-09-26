import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import { signToken, verifyCredentials } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import type { LoginResponse } from "@/lib/types";

/** Public: exchanges a username and password for a 12-hour JWT. */
export async function POST(req: Request) {
  try {
    const { username, password } = await parseBody(req, loginSchema);
    const user = await verifyCredentials(username, password);
    const body: LoginResponse = {
      token: signToken(user),
      user: { id: user.id, name: user.name, username: user.username!, role: user.role },
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
