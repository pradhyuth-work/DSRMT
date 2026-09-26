import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  { productCode: 1, name: "Lights 20s", unitPrice: 438, stockQty: 350 },
  { productCode: 2, name: "Red 20s", unitPrice: 404, stockQty: 580 },
  { productCode: 3, name: "Advance 20s", unitPrice: 432, stockQty: 0 },
  { productCode: 4, name: "Fuse 20s", unitPrice: 424, stockQty: 310 },
  { productCode: 5, name: "Vista Forest 20s", unitPrice: 424, stockQty: 330 },
  { productCode: 6, name: "Blue Advance 20s", unitPrice: 300, stockQty: 170 },
  { productCode: 7, name: "Red Advance 20s", unitPrice: 300, stockQty: 200 },
  { productCode: 8, name: "Lights 10s", unitPrice: 219, stockQty: 100 },
  { productCode: 9, name: "Red 10s", unitPrice: 202, stockQty: 840 },
  { productCode: 10, name: "Advance 10s", unitPrice: 216, stockQty: 180 },
  { productCode: 11, name: "Compact 10s", unitPrice: 107, stockQty: 13320 },
  { productCode: 12, name: "Fuse 10s", unitPrice: 212, stockQty: 240 },
  { productCode: 13, name: "Clove 10s", unitPrice: 222, stockQty: 158 },
  { productCode: 14, name: "Fine touch 10s", unitPrice: 175, stockQty: 480 },
  { productCode: 15, name: "Filter Black 12s", unitPrice: 239, stockQty: 0 },
  { productCode: 16, name: "FS Crush Tropical 10s", unitPrice: 96.5, stockQty: 1960 },
  { productCode: 17, name: "FS Clove Crush 69mm 10s", unitPrice: 108, stockQty: 0 },
  { productCode: 18, name: "FS Clove Crush 64mm 10s", unitPrice: 78, stockQty: 890 },
  { productCode: 19, name: "FS King 10s", unitPrice: 163.6, stockQty: 0 },
  { productCode: 20, name: "FS Special 10s", unitPrice: 96.5, stockQty: 0 },
  { productCode: 21, name: "Stellar CB 69mm 10s", unitPrice: 88, stockQty: 360 },
  { productCode: 22, name: "Stellar CB 64mm 10s", unitPrice: 55, stockQty: 3550 },
  { productCode: 23, name: "Stellar Fruity Mix 10s", unitPrice: 88, stockQty: 1825 },
  { productCode: 24, name: "Stellar Mode On", unitPrice: 88, stockQty: 2200 },
  { productCode: 25, name: "Stellar Paan Mix 20s", unitPrice: 324, stockQty: 290 },
  { productCode: 26, name: "Stellar Paan Pro 16s", unitPrice: 198, stockQty: 560 },
  { productCode: 27, name: "Stellar Define 20s", unitPrice: 324, stockQty: 310 },
  { productCode: 28, name: "Stellar Define Pro 16s", unitPrice: 198, stockQty: 200 },
  { productCode: 29, name: "Stellar Shift 20s", unitPrice: 342, stockQty: 2660 },
  { productCode: 30, name: "Stellar Shift Pro 16s", unitPrice: 198, stockQty: 1030 },
  { productCode: 31, name: "Stellar Shift Duos 20s", unitPrice: 360, stockQty: 3924 },
  { productCode: 32, name: "Stellar Edge 10s", unitPrice: 163.6, stockQty: 0 },
  { productCode: 33, name: "Originals 10s", unitPrice: 50.5, stockQty: 3640 },
  { productCode: 34, name: "Cavenders Gold (Red) 10s", unitPrice: 53, stockQty: 540 },
  { productCode: 35, name: "Cavenders Smooth (Blue) 10s", unitPrice: 53, stockQty: 160 },
  { productCode: 36, name: "IMLI 150MRP", unitPrice: 123, stockQty: 0 },
  { productCode: 37, name: "IMLI 200MRP", unitPrice: 170, stockQty: 257 },
  { productCode: 38, name: "Lemon", unitPrice: 180, stockQty: 0 },
  { productCode: 39, name: "Tic Tac Jar", unitPrice: 284, stockQty: 0 },
  { productCode: 40, name: "Tic Tac Hanger", unitPrice: 127, stockQty: 0 },
  { productCode: 41, name: "Kinder Joy 8pcs", unitPrice: 350, stockQty: 0 },
  { productCode: 42, name: "Kinder Joy Bons", unitPrice: 262, stockQty: 0 },
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
    // Give each seeded agent their own one-outlet route, so the "route -> one agent ->
    // its outlets" assignment has something to show out of the box.
    const people = await prisma.staff.findMany({ where: { name: { in: staff.map((s) => s.name) } }, orderBy: { createdAt: "asc" } });
    await Promise.all(
      outlets.map(async (o, i) => {
        const agent = people[i];
        const route = agent ? await prisma.route.create({ data: { name: `${agent.name}'s Route`, agentId: agent.id } }) : null;
        return prisma.outlet.create({ data: { ...o, routeId: route?.id } });
      }),
    );
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
