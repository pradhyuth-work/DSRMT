// Creates an admin, or resets an existing one, from ADMIN_USERNAME and ADMIN_PIN.
// Usage: npm run seed-admin   (values are read from the environment, then .env)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

try {
  process.loadEnvFile(".env"); // does not override variables already set in the shell
} catch {
  // no .env file: rely on the environment
}

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const pin = process.env.ADMIN_PIN;
  if (!username || !pin) throw new Error("Set ADMIN_USERNAME and ADMIN_PIN");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("ADMIN_USERNAME must be 3–32 characters: letters, numbers, dot, dash or underscore");
  }
  if (!/^\d{4,8}$/.test(pin)) throw new Error("ADMIN_PIN must be 4-8 digits");

  const passwordHash = await bcrypt.hash(pin, 12);
  const existing = await prisma.staff.findUnique({ where: { username }, select: { id: true } });

  if (existing) {
    // Reset: re-enable, make admin, set the PIN and end any existing sessions.
    await prisma.staff.update({
      where: { id: existing.id },
      data: { passwordHash, role: "admin", active: true, tokenVersion: { increment: 1 } },
    });
    console.log(`Admin "${username}" reset: PIN updated, role admin, account enabled.`);
  } else {
    await prisma.staff.create({
      data: {
        name: process.env.ADMIN_NAME?.trim() || "Administrator",
        phone: process.env.ADMIN_PHONE?.trim() || "",
        username,
        passwordHash,
        role: "admin",
        active: true,
      },
    });
    console.log(`Admin "${username}" created.`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
