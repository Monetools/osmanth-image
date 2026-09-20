import { ParseError, Reader } from "./bytes";
import { exifPpi, parseExifTiff, type ExifInfo } from "./exif";
import { parseIcc } from "./icc";
import type { EmbeddedPpi, IccInfo } from "./types";

// ITU-T T.81 Annex K luminance quantization table (quality-50 baseline used by libjpeg scaling).
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80,
  62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98,
  112, 100, 103, 99,
];
const STD_LUMA_SUM = STD_LUMA.reduce((a, b) => a + b, 0);

export type JpegFrameType = "baseline" | "extended" | "progressive" | "lossless" | "arithmetic" | "other";

const SOF_TYPES: Record<number, JpegFrameType> = {
  0xc0: "baseline", 0xc1: "extended", 0xc2: "progressive", 0xc3: "lossless",
  0xc5: "other", 0xc6: "other", 0xc7: "other",
  0xc9: "arithmetic", 0xca: "arithmetic", 0xcb: "arithmetic",
  0xcd: "arithmetic", 0xce: "arithmetic", 0xcf: "arithmetic",
};

/** Label the chroma subsampling from the first two components' sampling factors. */
function subsamplingLabel(factors: [number, number][]): string | null {
  if (factors.length < 3) return null;
  const maxH = Math.max(...factors.map((f) => f[0]));
  const maxV = Math.max(...factors.map((f) => f[1]));
  if (factors[1][0] === maxH && factors[1][1] === maxV) return "4:4:4";
  if (maxH === 2 && maxV === 1) return "4:2:2";
  if (maxH === 2 && maxV === 2) return "4:2:0";
  if (maxH === 4 && maxV === 1) return "4:1:1";
  return `${maxH}x${maxV}`;
}

/**
 * A complete JPEG ends with EOI (FFD9). Scan back over trailing padding rather than the whole
 * entropy-coded stream: a truncated file simply has no EOI near its end.
 */
function hasEndOfImage(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 2; i >= Math.max(0, bytes.length - 64); i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
  }
  return false;
}

export interface JpegInfo {
  width: number;
  height: number;
  components: number;
  precision: number;
  progressive: boolean;
  frameType: JpegFrameType;
  subsampling: string | null;
  /** True when the file ends with EOI. */
  complete: boolean;
  /** Structural problems that do not stop parsing. */
  problems: string[];
  exif: ExifInfo | null;
  jfifPpi: { x: number; y: number } | null;
  icc: IccInfo | null;
  adobeTransform: number | null;
  quality: number | null;
}

/**
 * Invert libjpeg's quality scaling from the luminance table:
 *   scale = q<50 ? 5000/q : 200-2q ; table = std*scale/100
 */
export function estimateJpegQuality(lumaTable: number[]): number {
  const sum = lumaTable.reduce((a, b) => a + b, 0);
  const scale = (sum * 100) / STD_LUMA_SUM;
  let q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  q = Math.max(1, Math.min(100, q));
  return Math.round(q);
}

export function parseJpeg(bytes: Uint8Array): JpegInfo {
  const r = new Reader(bytes);
  if (r.u16(0) !== 0xffd8) throw new ParseError("not a JPEG");
  const info: JpegInfo = {
    width: 0, height: 0, components: 0, precision: 8, progressive: false,
    frameType: "other", subsampling: null, complete: hasEndOfImage(bytes), problems: [],
    exif: null, jfifPpi: null, icc: null, adobeTransform: null, quality: null,
  };
  const iccChunks: { seq: number; data: Uint8Array }[] = [];
  let iccCount = 0;
  let sawSof = false;
  let sawSos = false;
  let o = 2;
  let guard = 0;
  while (o + 4 <= bytes.length && guard++ < 10000) {
    if (r.u8(o) !== 0xff) throw new ParseError(`expected marker at ${o}`);
    let marker = r.u8(o + 1);
    // Fill bytes
    while (marker === 0xff) {
      o++;
      marker = r.u8(o + 1);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const len = r.u16(o + 2);
    if (len < 2) throw new ParseError("bad segment length");
    const seg = o + 4;
    const segLen = len - 2;
    r.check(seg, segLen);

    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (sawSof) info.problems.push("The file contains more than one frame header.");
      sawSof = true;
      info.precision = r.u8(seg);
      info.height = r.u16(seg + 1);
      info.width = r.u16(seg + 3);
      info.components = r.u8(seg + 5);
      info.frameType = SOF_TYPES[marker] ?? "other";
      info.progressive = info.frameType === "progressive";
      const factors: [number, number][] = [];
      for (let c = 0; c < info.components; c++) {
        const o = seg + 6 + c * 3;
        if (o + 2 > seg + segLen) break;
        const f = r.u8(o + 1);
        factors.push([f >> 4, f & 0x0f]);
      }
      info.subsampling = subsamplingLabel(factors);
    } else if (marker === 0xe0 && segLen >= 12 && r.ascii(seg, 5) === "JFIF\0") {
      const units = r.u8(seg + 7);
      const x = r.u16(seg + 8);
      const y = r.u16(seg + 10);
      if (x > 0 && y > 0) {
        if (units === 1) info.jfifPpi = { x, y };
        else if (units === 2) info.jfifPpi = { x: x * 2.54, y: y * 2.54 };
      }
    } else if (marker === 0xe1 && segLen > 6 && r.ascii(seg, 6) === "Exif\0\0" && !info.exif) {
      try {
        info.exif = parseExifTiff(r.slice(seg + 6, segLen - 6));
      } catch {
        info.exif = null; // Malformed EXIF must never break inspection.
      }
    } else if (marker === 0xe2 && segLen > 14 && r.ascii(seg, 12) === "ICC_PROFILE\0") {
      iccChunks.push({ seq: r.u8(seg + 12), data: r.slice(seg + 14, segLen - 14) });
      iccCount = r.u8(seg + 13); // total chunk count announced by the encoder
    } else if (marker === 0xee && segLen >= 12 && r.ascii(seg, 5) === "Adobe") {
      info.adobeTransform = r.u8(seg + 11);
    } else if (marker === 0xdb) {
      let p = seg;
      while (p < seg + segLen) {
        const pq = r.u8(p) >> 4;
        const tq = r.u8(p) & 0x0f;
        p++;
        const table: number[] = [];
        for (let i = 0; i < 64; i++) {
          table.push(pq ? r.u16(p) : r.u8(p));
          p += pq ? 2 : 1;
        }
        if (tq === 0 && info.quality === null) info.quality = estimateJpegQuality(table);
      }
    } else if (marker === 0xda) {
      sawSos = true;
      break; // Start of scan: all metadata we need precedes image data.
    }
    o = seg + segLen;
  }
  if (iccChunks.length) {
    iccChunks.sort((a, b) => a.seq - b.seq);
    // An ICC profile split across APP2 segments is only usable if every announced chunk is present.
    const expected = iccCount || iccChunks.length;
    const complete = iccChunks.length === expected && iccChunks.every((c, i) => c.seq === i + 1);
    if (!complete) {
      info.problems.push("The embedded colour profile is incomplete, so the colour space could not be confirmed.");
    } else {
      const total = iccChunks.reduce((n, c) => n + c.data.length, 0);
      const buf = new Uint8Array(total);
      let p = 0;
      for (const c of iccChunks) {
        buf.set(c.data, p);
        p += c.data.length;
      }
      info.icc = parseIcc(buf);
      if (!info.icc.readable) info.problems.push("An embedded colour profile is present but could not be read.");
    }
  }
  if (!info.width || !info.height) throw new ParseError("JPEG has no frame header");
  if (!sawSos) info.problems.push("The file has no image data.");
  if (!info.complete) info.problems.push("The file is truncated: it has no end-of-image marker.");
  return info;
}

export function jpegEmbeddedPpi(info: JpegInfo): EmbeddedPpi | null {
  // EXIF resolution is what most editors (and print dialogs) read first; JFIF is the fallback.
  const e = info.exif ? exifPpi(info.exif) : null;
  if (e) return { ...e, source: "exif" };
  if (info.jfifPpi) return { ...info.jfifPpi, source: "jfif" };
  return null;
}
