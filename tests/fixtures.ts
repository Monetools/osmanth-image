/** Synthetic image builders: byte-exact headers so inspection results are fully deterministic. */
import { zlibSync } from "fflate";
import { crc32 } from "../src/engine/fix/metadata";

const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80,
  62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98,
  112, 100, 103, 99,
];

const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];

/** libjpeg quality scaling of the standard luminance table. */
export function scaledLuma(q: number): number[] {
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return STD_LUMA.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

export type Xyz = [number, number, number];
/** sRGB colorants exactly as PrintReady's ICC reader expects to find them. */
export const SRGB_XYZ: { r: Xyz; g: Xyz; b: Xyz } = {
  r: [0.4361, 0.2225, 0.0139],
  g: [0.3851, 0.7169, 0.0971],
  b: [0.1431, 0.0606, 0.7141],
};
/** Deliberately wide-gamut colorants (not sRGB) for "renamed / mislabelled profile" tests. */
export const WIDE_XYZ: { r: Xyz; g: Xyz; b: Xyz } = {
  r: [0.6097, 0.3111, 0.0195],
  g: [0.2053, 0.6257, 0.0609],
  b: [0.1492, 0.0632, 0.7448],
};

const s15f16 = (v: number) => be32(Math.round(v * 65536) >>> 0);
const xyzTag = (v: Xyz) => [...ascii("XYZ "), 0, 0, 0, 0, ...s15f16(v[0]), ...s15f16(v[1]), ...s15f16(v[2])];

export function iccProfile(
  colorSpace: "RGB " | "CMYK" | "GRAY",
  description: string,
  colorants?: { r: Xyz; g: Xyz; b: Xyz },
): number[] {
  const bodies: Array<{ sig: string; body: number[] }> = [
    { sig: "desc", body: [...ascii("desc"), 0, 0, 0, 0, ...be32(description.length + 1), ...ascii(description), 0] },
  ];
  if (colorants) {
    bodies.push({ sig: "rXYZ", body: xyzTag(colorants.r) });
    bodies.push({ sig: "gXYZ", body: xyzTag(colorants.g) });
    bodies.push({ sig: "bXYZ", body: xyzTag(colorants.b) });
  }
  const tableEnd = 132 + bodies.length * 12;
  const entries: number[] = [];
  const data: number[] = [];
  let off = tableEnd;
  for (const t of bodies) {
    entries.push(...ascii(t.sig), ...be32(off), ...be32(t.body.length));
    data.push(...t.body);
    off += t.body.length;
  }
  const header = new Array(128).fill(0);
  header.splice(0, 4, ...be32(tableEnd + data.length));
  header.splice(16, 4, ...ascii(colorSpace));
  header.splice(36, 4, ...ascii("acsp"));
  return [...header, ...be32(bodies.length), ...entries, ...data];
}

export interface JpegOpts {
  width: number;
  height: number;
  components?: 1 | 3 | 4;
  jfifDpi?: number | null;
  exifOrientation?: number;
  exifDpi?: number;
  quality?: number;
  icc?: number[];
  /** Split the ICC profile across N APP2 segments; drop the last one to simulate a damaged file. */
  iccChunks?: number;
  iccDropLastChunk?: boolean;
  exifColorSpace?: number;
  adobeTransform?: number;
  progressive?: boolean;
  /** Omit the end-of-image marker (truncated file). */
  noEoi?: boolean;
  /** Per-component [h, v] sampling factors; default 1×1 for every component (4:4:4). */
  sampling?: [number, number][];
}

export function makeJpeg(o: JpegOpts): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  if (o.jfifDpi !== null) {
    const d = o.jfifDpi ?? 72;
    out.push(...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 1, ...be16(d), ...be16(d), 0, 0]));
  }
  if (o.exifOrientation !== undefined || o.exifDpi !== undefined || o.exifColorSpace !== undefined) {
    // Big-endian TIFF: IFD0 at 8; rationals stored after the IFD.
    const entries: number[][] = [];
    const extra: number[] = [];
    const nEntries =
      (o.exifOrientation !== undefined ? 1 : 0) + (o.exifDpi !== undefined ? 3 : 0) + (o.exifColorSpace !== undefined ? 1 : 0);
    const dataStart = 8 + 2 + nEntries * 12 + 4;
    if (o.exifOrientation !== undefined) entries.push([...be16(0x0112), ...be16(3), ...be32(1), ...be16(o.exifOrientation), 0, 0]);
    if (o.exifDpi !== undefined) {
      entries.push([...be16(0x011a), ...be16(5), ...be32(1), ...be32(dataStart)]);
      entries.push([...be16(0x011b), ...be16(5), ...be32(1), ...be32(dataStart + 8)]);
      entries.push([...be16(0x0128), ...be16(3), ...be32(1), ...be16(2), 0, 0]);
      extra.push(...be32(o.exifDpi), ...be32(1), ...be32(o.exifDpi), ...be32(1));
    }
    if (o.exifColorSpace !== undefined) {
      // Exif sub-IFD placed after IFD0's rational data; one entry: ColorSpace (0xA001).
      const subOff = dataStart + extra.length;
      entries.push([...be16(0x8769), ...be16(4), ...be32(1), ...be32(subOff)]);
      extra.push(...be16(1), ...be16(0xa001), ...be16(3), ...be32(1), ...be16(o.exifColorSpace), 0, 0, ...be32(0));
    }
    const nAll = entries.length;
    const tiff = [...ascii("MM"), ...be16(42), ...be32(8), ...be16(nAll), ...entries.flat(), ...be32(0), ...extra];
    out.push(...seg(0xe1, [...ascii("Exif"), 0, 0, ...tiff]));
  }
  if (o.icc) {
    const n = o.iccChunks ?? 1;
    const per = Math.ceil(o.icc.length / n);
    for (let k = 0; k < n; k++) {
      if (o.iccDropLastChunk && k === n - 1) break;
      out.push(...seg(0xe2, [...ascii("ICC_PROFILE"), 0, k + 1, n, ...o.icc.slice(k * per, (k + 1) * per)]));
    }
  }
  if (o.adobeTransform !== undefined) out.push(...seg(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, o.adobeTransform]));
  out.push(...seg(0xdb, [0x00, ...scaledLuma(o.quality ?? 90)]));
  const nc = o.components ?? 3;
  const comps: number[] = [];
  for (let i = 0; i < nc; i++) {
    const f = o.sampling?.[i] ?? [1, 1];
    comps.push(i + 1, (f[0] << 4) | f[1], 0);
  }
  out.push(...seg(o.progressive ? 0xc2 : 0xc0, [8, ...be16(o.height), ...be16(o.width), nc, ...comps]));
  out.push(...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x00);
  if (!o.noEoi) out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

function pngChunk(type: string, data: number[] | Uint8Array): number[] {
  const body = new Uint8Array([...ascii(type), ...data]);
  return [...be32(data.length), ...body, ...be32(crc32(body))];
}

export interface PngOpts {
  width: number;
  height: number;
  colorType?: 0 | 2 | 3 | 4 | 6;
  bitDepth?: 1 | 2 | 4 | 8 | 16;
  /** Omit the IEND chunk (truncated file). */
  noIend?: boolean;
  ppi?: number;
  iccDescription?: string;
  srgb?: boolean;
}

export function makePng(o: PngOpts): Uint8Array {
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  out.push(...pngChunk("IHDR", [...be32(o.width), ...be32(o.height), o.bitDepth ?? 8, o.colorType ?? 2, 0, 0, 0]));
  if (o.iccDescription) {
    const prof = zlibSync(new Uint8Array(iccProfile("RGB ", o.iccDescription)));
    out.push(...pngChunk("iCCP", [...ascii("icc"), 0, 0, ...prof]));
  }
  if (o.srgb) out.push(...pngChunk("sRGB", [0]));
  if (o.ppi) {
    const ppm = Math.round(o.ppi / 0.0254);
    out.push(...pngChunk("pHYs", [...be32(ppm), ...be32(ppm), 1]));
  }
  out.push(...pngChunk("IDAT", zlibSync(new Uint8Array(0))));
  if (!o.noIend) out.push(...pngChunk("IEND", []));
  return new Uint8Array(out);
}

export function makeWebpVp8x(width: number, height: number, alpha: boolean): Uint8Array {
  const le24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
  const vp8x = [...ascii("VP8X"), 10, 0, 0, 0, alpha ? 0x10 : 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)];
  const size = 4 + vp8x.length;
  return new Uint8Array([...ascii("RIFF"), size & 0xff, (size >> 8) & 0xff, 0, 0, ...ascii("WEBP"), ...vp8x]);
}
