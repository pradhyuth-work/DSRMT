// Minimal QR code maker (byte mode, error correction M) that returns a grayscale PNG. The GSP sends the
// government's signed QR *text* for a real e-invoice, so the picture has to be drawn here.
import { deflateSync } from "node:zlib";

// Per version 1..40 at level M: error-correction bytes per block, and number of blocks.
const ECC_LEN = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

function totalBytes(v: number) {
  let bits = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; bits -= (25 * a - 10) * a - 55; if (v >= 7) bits -= 36; }
  return bits >> 3;
}

/** Multiplication in GF(256) with the QR polynomial. */
function mul(a: number, b: number) {
  let r = 0;
  for (let i = 7; i >= 0; i--) { r = (r << 1) ^ ((r >>> 7) * 0x11d); r ^= ((b >>> i) & 1) * a; }
  return r;
}

/** Reed-Solomon error-correction bytes for one block. */
function ecc(data: number[], len: number) {
  const gen: number[] = new Array(len).fill(0);
  gen[len - 1] = 1;
  let root = 1;
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < len; j++) gen[j] = mul(gen[j], root) ^ (j + 1 < len ? gen[j + 1] : 0);
    root = mul(root, 2);
  }
  const rem: number[] = new Array(len).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift()!;
    rem.push(0);
    gen.forEach((g, i) => { rem[i] ^= mul(g, f); });
  }
  return rem;
}

/** Data bytes with their error correction, interleaved across blocks. */
function codewords(text: Buffer, v: number) {
  const eccLen = ECC_LEN[v - 1], blocks = BLOCKS[v - 1], total = totalBytes(v), dataLen = total - eccLen * blocks;
  const bits: number[] = [];
  const put = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(text.length, v < 10 ? 8 : 16);
  for (const b of text) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((x, b) => (x << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);
  const shortBlocks = blocks - (total % blocks), shortLen = Math.floor(total / blocks) - eccLen;
  const d: number[][] = [], e: number[][] = [];
  for (let i = 0, at = 0; i < blocks; i++) {
    const part = data.slice(at, (at += shortLen + (i < shortBlocks ? 0 : 1)));
    d.push(part);
    e.push(ecc(part, eccLen));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++) for (const b of d) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < eccLen; i++) for (const b of e) out.push(b[i]);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** How hard a pattern is to scan (the standard's four penalty rules); lower is better. */
function penalty(m: boolean[][]) {
  const n = m.length;
  let score = 0, dark = 0;
  for (const rows of [m, m.map((_, x) => m.map((r) => r[x]))]) {
    for (const r of rows) {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && r[i] === r[i - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      const s = `0000${r.map((c) => (c ? "1" : "0")).join("")}0000`;
      for (let i = 0; i + 11 <= s.length; i++) { const w = s.slice(i, i + 11); if (w === "10111010000" || w === "00001011101") score += 40; }
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x && y && m[y][x] === m[y - 1][x] && m[y][x] === m[y][x - 1] && m[y][x] === m[y - 1][x - 1]) score += 3;
  }
  return score + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}

/** The QR squares (true = dark) for the text, or null if it is too long for one code. */
export function qrMatrix(value: string): boolean[][] | null {
  const text = Buffer.from(value, "utf8");
  let v = 1;
  while (v <= 40 && 4 + (v < 10 ? 8 : 16) + text.length * 8 > (totalBytes(v) - ECC_LEN[v - 1] * BLOCKS[v - 1]) * 8) v++;
  if (v > 40) return null;
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fixed = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fixed[y][x] = true; };

  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Finder patterns in three corners, with their white border.
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
    }
  }
  // Alignment patterns.
  if (v > 1) {
    const count = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (count * 2 - 2)) * 2;
    const at = [6];
    for (let p = n - 7; at.length < count; p -= step) at.splice(1, 0, p);
    at.forEach((cy, i) => at.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const format = (mask: number) => {
    let rem = mask; // level M is 00, so the data is just the mask number
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((mask << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  format(0); // reserves the squares; written again once the mask is chosen
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1, a = n - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }
  // Data zig-zags up and down in two-square columns from the bottom right.
  const words = codewords(text, v);
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - i : i;
        if (fixed[y][x] || k >= words.length * 8) continue;
        m[y][x] = ((words[k >> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
  }
  const flip = (mask: number) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fixed[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask); format(mask);
    const s = penalty(m);
    if (s < bestScore) { best = mask; bestScore = s; }
    flip(mask);
  }
  flip(best); format(best);
  return m;
}

const CRC = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  let c = 0xffffffff;
  for (const b of body) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

/** The QR code as a grayscale PNG, `scale` pixels per square with a white margin of two squares. */
export function qrPng(value: string, scale = 4): Buffer | null {
  const m = qrMatrix(value);
  if (!m) return null;
  const margin = 2, size = (m.length + margin * 2) * scale;
  const raw = Buffer.alloc((size + 1) * size, 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0; // no PNG filter
    const row = m[Math.floor(y / scale) - margin];
    for (let x = 0; x < size; x++) if (row?.[Math.floor(x / scale) - margin]) raw[y * (size + 1) + 1 + x] = 0;
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; // 8-bit grayscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const SIGNED = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * The GSP's `qr_code_image` as base64 PNG. Test mode sends a ready picture; a real filing sends the
 * government's signed QR text (a token, possibly base64-wrapped), which is drawn here.
 */
export function qrFromGsp(field: string | null | undefined): string | null {
  const s = (field ?? "").replace(/^data:image\/png;base64,/, "").replace(/\s+/g, "");
  if (s.startsWith("iVBOR")) return /^[A-Za-z0-9+/]+=*$/.test(s) ? s : null;
  const token = SIGNED.test(s) ? s : Buffer.from(s, "base64").toString("utf8").trim();
  return SIGNED.test(token) ? qrPng(token)?.toString("base64") ?? null : null;
}
