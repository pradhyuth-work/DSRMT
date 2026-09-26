import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { HttpError } from "./api";
import type { AuthUser, Role } from "./types";

const TOKEN_TTL = "12h";
const BCRYPT_ROUNDS = 12;
// Compared against when a username doesn't exist, so the response takes the same time.
const DUMMY_HASH = bcrypt.hashSync("dsrmt-timing-equaliser", BCRYPT_ROUNDS);

interface TokenPayload {
  sub: string;
  role: Role;
  ver: number;
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters");
  }
  return value;
}

export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function signToken(user: { id: string; role: Role; tokenVersion: number }): string {
  const payload: TokenPayload = { sub: user.id, role: user.role, ver: user.tokenVersion };
  return jwt.sign(payload, secret(), { expiresIn: TOKEN_TTL, algorithm: "HS256" });
}

/** Returns the user if the credentials are valid and the account is active, otherwise throws 401. */
export async function verifyCredentials(username: string, password: string) {
  const user = await prisma.staff.findUnique({ where: { username: normaliseUsername(username) } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw new HttpError(401, "Invalid username or password");
  if (!user.active) throw new HttpError(403, "This account is disabled. Contact an admin.");
  return user;
}

/**
 * Authenticates a request from its `Authorization: Bearer <jwt>` header.
 * The user is re-read from the database on every request, so disabling an account,
 * changing a role or resetting a password takes effect immediately.
 */
export async function requireAuth(req: Request): Promise<AuthUser> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(401, "Sign in required");

  let payload: TokenPayload;
  try {
    payload = jwt.verify(match[1], secret(), { algorithms: ["HS256"] }) as unknown as TokenPayload;
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }

  const user = await prisma.staff.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, username: true, role: true, active: true, tokenVersion: true },
  });
  if (!user || !user.username || user.tokenVersion !== payload.ver) {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
  if (!user.active) throw new HttpError(403, "This account is disabled. Contact an admin.");

  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export function requireRole(user: AuthUser, roles: readonly Role[]): AuthUser {
  if (!roles.includes(user.role)) throw new HttpError(403, "You don't have permission to do that");
  return user;
}

/** requireAuth + requireRole in one call. */
export async function authorize(req: Request, roles: readonly Role[]): Promise<AuthUser> {
  return requireRole(await requireAuth(req), roles);
}

export const ALL_ROLES = ["admin", "stock", "agent"] as const satisfies readonly Role[];
