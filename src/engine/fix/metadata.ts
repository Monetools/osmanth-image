import { startsWith } from "../inspect/bytes";
import { PNG_SIG } from "../inspect/png";

/**
 * Write the print-size tag (DPI/PPI metadata). This changes ONLY how big the file opens in print
 * dialogs — it never changes pixels and is never presented as a quality improvement (spec §4.1).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16be(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}
function u32be(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

export function setJpegPpi(bytes: Uint8Array, ppi: number): Uint8Array {
  if (!startsWith(bytes, [0xff, 0xd8])) throw new Error("not a JPEG");
  const d = Math.max(1, Math.min(65535, Math.round(ppi)));
  // Existing JFIF APP0 right after SOI (what browser encoders emit): patch in place.
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && startsWith(bytes, [0x4a, 0x46, 0x49, 0x46, 0x00], 6)) {
    const out = bytes.slice();
    out[13] = 1; // units: dots per inch
    out.set(u16be(d), 14);
    out.set(u16be(d), 16);
    return out;
  }
  const app0 = new Uint8Array([
    0xff, 0xe0, ...u16be(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 1, ...u16be(d), ...u16be(d), 0, 0,
  ]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

export function setPngPpi(bytes: Uint8Array, ppi: number): Uint8Array {
  if (!startsWith(bytes, PNG_SIG)) throw new Error("not a PNG");
  const ppm = Math.round(ppi / 0.0254);
  const body = new Uint8Array([0x70, 0x48, 0x59, 0x73, ...u32be(ppm), ...u32be(ppm), 1]); // "pHYs" + data
  const chunk = new Uint8Array([...u32be(9), ...body, ...u32be(crc32(body))]);
  // Rebuild the chunk list, dropping any existing pHYs and inserting ours right after IHDR.
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= bytes.length) {
    const len = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const end = o + 12 + len;
    if (end > bytes.length) throw new Error("truncated PNG");
    if (type !== "pHYs") parts.push(bytes.subarray(o, end));
    if (type === "IHDR") parts.push(chunk);
    o = end;
    if (type === "IEND") break;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

export function setPpi(bytes: Uint8Array, format: "jpeg" | "png", ppi: number): Uint8Array {
  return format === "jpeg" ? setJpegPpi(bytes, ppi) : setPngPpi(bytes, ppi);
}
