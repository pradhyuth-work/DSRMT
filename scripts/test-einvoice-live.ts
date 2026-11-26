// Checks of the pure GSP helpers (no database, no network).
// Usage: npm run test:einvoice-live
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readReply, signedInvoiceMismatch } from "../lib/gsp-parse";
import { pngToGray } from "../lib/png";

assert.equal(readReply(200, { success: true, irn: "x" }).kind, "ok");
for (const s of [400, 401, 402, 403, 429]) assert.equal(readReply(s, { success: false, error: "no" }).kind, "rejected", `status ${s}`);
assert.equal(readReply(200, { success: false, error: "no" }).kind, "rejected");
// Anything unclear must stay "unknown": the invoice may have been registered.
for (const s of [200, 500, 502, 503, 504]) assert.equal(readReply(s, null).kind, "unknown", `status ${s}`);
assert.equal(readReply(502, { success: false, error: "down" }).kind, "unknown");

const sent = { buyerGstin: "29ABCDE1234F1Z5", total: 1000, date: "26/11/2026" };
const signed = (gstin: string, total: number) =>
  `a.${Buffer.from(JSON.stringify({ data: JSON.stringify({ BuyerDtls: { Gstin: gstin }, ValDtls: { TotInvVal: total }, DocDtls: { Dt: sent.date } }) })).toString("base64url")}.c`;
assert.equal(signedInvoiceMismatch(signed(sent.buyerGstin, 1000), sent), null);
assert.match(signedInvoiceMismatch(signed(sent.buyerGstin, 5000), sent)!, /amount 5000/);
assert.match(signedInvoiceMismatch(signed("29ZZZZZ9999Z1Z9", 1000), sent)!, /buyer/);
assert.equal(signedInvoiceMismatch("not-a-token", sent), null);

// A 2x2 grayscale PNG (CRCs are not checked by the reader).
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 0, 255, 0, 255, 0]))), chunk("IEND", Buffer.alloc(0))]);
assert.deepEqual([...pngToGray(png)!.pixels], [0, 255, 255, 0]);
assert.equal(pngToGray(Buffer.from("nonsense")), null);

console.log("einvoice-live: all checks passed");
