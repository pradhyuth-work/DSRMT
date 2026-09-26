import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  { productCode: 1, name: "Mineral Water 1L (Case of 12)", unitPrice: 180, stockQty: 250 },
  { productCode: 2, name: "Cola 500ml (Case of 24)", unitPrice: 720, stockQty: 120 },
  { productCode: 3, name: "Potato Chips 50g (Box of 30)", unitPrice: 450, stockQty: 90 },
  { productCode: 4, name: "Glucose Biscuits (Box of 48)", unitPrice: 384, stockQty: 60 },
  { productCode: 5, name: "Mango Juice 200ml (Case of 27)", unitPrice: 540, stockQty: 8 },
];

const outlets = [
  { name: "Sri Lakshmi General Stores", phone: "9876500001" },
  { name: "City Fresh Mart", phone: "9876500002" },
  { name: "Green Valley Supermarket", phone: "9876500003" },
];

const staff = [
  { name: "Ravi Kumar", phone: "9000000101" },
  { name: "Anita Sharma", phone: "9000000102" },
  { name: "Mohammed Irfan", phone: "9000000103" },
];

async function main() {
  // Idempotent: `npm run dev` runs this on every start, so only seed an empty database.
  const [productCount, outletCount, staffCount] = await Promise.all([
    prisma.product.count(),
    prisma.outlet.count(),
    prisma.staff.count(),
  ]);

  if (productCount === 0) await prisma.product.createMany({ data: products });
  if (staffCount === 0) await prisma.staff.createMany({ data: staff });
  if (outletCount === 0) {
    // Match this local check/demo data's outlets 1:1 to the seeded staff, so the "one
    // agent per outlet" assignment has something to show out of the box.
    const people = await prisma.staff.findMany({ where: { name: { in: staff.map((s) => s.name) } }, orderBy: { createdAt: "asc" } });
    await Promise.all(outlets.map((o, i) => prisma.outlet.create({ data: { ...o, agentId: people[i]?.id } })));
  }

  const seeded = [productCount === 0 && "products", outletCount === 0 && "outlets", staffCount === 0 && "staff"].filter(Boolean);
  console.log(seeded.length ? `Seeded: ${seeded.join(", ")}` : "Database already seeded — skipping.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
