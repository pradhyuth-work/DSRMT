// Fixture-based check of buildMtDsr — no database involved.
// Usage: npx tsx scripts/test-mt-dsr.ts [fixture.json] [out.xlsx]
//   With no arguments it builds a tiny built-in fixture and checks the totals.
//   With a fixture ({from_, to, invoices, openingStock, received}) it writes the workbook to out.xlsx.
import { readFileSync, writeFileSync } from "node:fs"; // eslint-disable-line
import { buildMtDsr, type MtDsrInput } from "../lib/mt-dsr";

const [fixturePath, outPath] = process.argv.slice(2);

if (fixturePath) {
  const f = JSON.parse(readFileSync(fixturePath, "utf8")) as MtDsrInput & { from_?: string };
  const input: MtDsrInput = { ...f, from: f.from_ ?? f.from };
  const r = buildMtDsr(input);
  writeFileSync(outPath ?? "mt-dsr-test.xlsx", r.bytes);
  console.log(`wrote ${outPath} — ${r.invoiceCount} invoices, unmapped: ${r.unmappedProducts.join(", ") || "none"}`);
} else {
  const input: MtDsrInput = {
    from: "2026-10-01",
    to: "2026-10-03",
    openingStock: { "Compact 10s": 100, "Fuse 20s": 50 },
    received: [{ date: "2026-10-02", productName: "Compact 10s", quantity: 40 }],
    invoices: [
      { date: "2026-10-01", fa: "Vikram", outlet: "Shop A", amount: 1000, items: [{ productName: "Compact 10s", quantity: 20 }, { productName: "Mystery Brand", quantity: 3 }] },
      { date: "2026-10-03", fa: "Raj", outlet: "Shop B", amount: 500, items: [{ productName: "compact  10s", quantity: 10 }, { productName: "Fuse 20s", quantity: 5 }] },
    ],
  };
  const r = buildMtDsr(input);
  const assert = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(`FAIL: ${msg}`);
  };
  assert(r.invoiceCount === 2, "invoice count");
  assert(r.unmappedProducts.join() === "Mystery Brand", "unmapped product reported");
  assert(r.bytes[0] === 0x50 && r.bytes[1] === 0x4b, "output is a zip");
  console.log("ok");
}
