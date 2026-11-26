// Minimal PNG reader: turns the QR code image the GSP sends into 8-bit grayscale pixels for the PDF invoice.
// Handles non-interlaced PNGs of every colour type at the depths a QR image can come in (1, 2, 4, 8).
import { inflateSync } from "node:zlib";

export interface GrayImage { width: number; height: number; pixels: Buffer }

export function pngToGray(png: Buffer): GrayImage | null {
  try {
    if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) return null;
    let p = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
    let palette: Buffer | null = null;
    const idat: Buffer[] = [];
    while (p + 8 <= png.length) {
      const len = png.readUInt32BE(p);
      const kind = png.toString("latin1", p + 4, p + 8);
      const data = png.subarray(p + 8, p + 8 + len);
      if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
      if (kind === "PLTE") palette = data;
      if (kind === "IDAT") idat.push(data);
      p += 12 + len;
    }
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
    if (!channels || ![1, 2, 4, 8].includes(depth) || interlace !== 0 || !width || !height || width > 4000 || height > 4000) return null;
    if (depth < 8 && channels !== 1) return null;
    const rowBytes = Math.ceil((width * channels * depth) / 8);
    const bpp = Math.max(1, (channels * depth) / 8);
    const raw = inflateSync(Buffer.concat(idat));
    if (raw.length < (rowBytes + 1) * height) return null;
    const pixels = Buffer.alloc(width * height);
    let prev: Buffer = Buffer.alloc(rowBytes);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (rowBytes + 1)];
      const row = Buffer.from(raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)));
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let add = 0;
        if (filter === 1) add = a;
        else if (filter === 2) add = b;
        else if (filter === 3) add = (a + b) >> 1;
        else if (filter === 4) {
          const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[i] = (row[i] + add) & 255;
      }
      for (let x = 0; x < width; x++) {
        let r: number, g: number, b: number, alpha = 255;
        if (depth < 8) {
          const v = (row[(x * depth) >> 3] >> (8 - depth - ((x * depth) % 8))) & ((1 << depth) - 1);
          if (type === 3) { r = palette![v * 3]; g = palette![v * 3 + 1]; b = palette![v * 3 + 2]; }
          else r = g = b = Math.round((v * 255) / ((1 << depth) - 1));
        } else {
          const o = x * channels;
          if (type === 3) { const v = row[o]; r = palette![v * 3]; g = palette![v * 3 + 1]; b = palette![v * 3 + 2]; }
          else if (type === 0 || type === 4) { r = g = b = row[o]; if (type === 4) alpha = row[o + 1]; }
          else { r = row[o]; g = row[o + 1]; b = row[o + 2]; if (type === 6) alpha = row[o + 3]; }
        }
        // Transparent areas print as white paper.
        const lum = (r * 299 + g * 587 + b * 114) / 1000;
        pixels[y * width + x] = Math.round((lum * alpha + 255 * (255 - alpha)) / 255);
      }
      prev = row;
    }
    return { width, height, pixels };
  } catch {
    return null;
  }
}
