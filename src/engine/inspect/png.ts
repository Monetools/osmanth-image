import { Unzlib } from "fflate";
import { ParseError, Reader, startsWith } from "./bytes";
import { parseExifTiff, type ExifInfo } from "./exif";
import { parseIcc } from "./icc";
import type { IccInfo } from "./types";

export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_ICC_INFLATED = 4 * 1024 * 1024;

export interface PngInfo {
  /** True when the chunk stream ends with IEND. */
  complete: boolean;
  problems: string[];
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
  hasTrns: boolean;
  physPpi: { x: number; y: number } | null;
  icc: IccInfo | null;
  srgb: boolean;
  animated: boolean;
  exif: ExifInfo | null;
}

export function parsePng(bytes: Uint8Array): PngInfo {
  if (!startsWith(bytes, PNG_SIG)) throw new ParseError("not a PNG");
  const r = new Reader(bytes);
  if (r.ascii(12, 4) !== "IHDR") throw new ParseError("PNG missing IHDR");
  const info: PngInfo = {
    complete: hasIend(bytes), problems: [],
    width: r.u32(16), height: r.u32(20), bitDepth: r.u8(24), colorType: r.u8(25), interlaced: r.u8(28) === 1,
    hasTrns: false, physPpi: null, icc: null, srgb: false, animated: false, exif: null,
  };
  let o = 8;
  let guard = 0;
  while (o + 8 <= bytes.length && guard++ < 100000) {
    const len = r.u32(o);
    const type = r.ascii(o + 4, 4);
    const data = o + 8;
    r.check(data, len);
    if (type === "IDAT" || type === "IEND") break;
    if (type === "pHYs" && len >= 9 && r.u8(data + 8) === 1) {
      // pixels per metre -> pixels per inch
      info.physPpi = { x: r.u32(data) * 0.0254, y: r.u32(data + 4) * 0.0254 };
    } else if (type === "tRNS") {
      info.hasTrns = true;
    } else if (type === "sRGB") {
      info.srgb = true;
    } else if (type === "acTL") {
      info.animated = true;
    } else if (type === "eXIf") {
      try {
        info.exif = parseExifTiff(r.slice(data, len));
      } catch {
        info.exif = null;
      }
    } else if (type === "iCCP") {
      let nul = data;
      while (nul < data + Math.min(len, 80) && r.u8(nul) !== 0) nul++;
      const compressed = r.slice(nul + 2, data + len - (nul + 2));
      try {
        info.icc = parseIcc(inflateCapped(compressed, MAX_ICC_INFLATED));
      } catch {
        info.icc = {
          colorSpace: "OTHER", description: r.ascii(data, nul - data), sizeBytes: 0,
          family: "Other", readable: false,
        };
        info.problems.push("An embedded colour profile is present but could not be read.");
      }
    }
    o = data + len + 4; // + CRC
  }
  if (!info.complete) info.problems.push("The file is truncated: it has no end marker.");
  return info;
}

/** A complete PNG ends with an IEND chunk. */
function hasIend(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 8; i >= Math.max(0, bytes.length - 24); i--) {
    if (bytes[i] === 0x49 && bytes[i + 1] === 0x45 && bytes[i + 2] === 0x4e && bytes[i + 3] === 0x44) return true;
  }
  return false;
}

/**
 * 1-bit artwork (and 2-bit palettes) is line art: solid strokes with hard edges, which need more
 * pixels per inch than a photograph before the edges look ragged. Profiles decide whether that
 * matters (`line_art_ppi_multiplier`).
 */
export function pngIsLineArt(i: PngInfo): boolean {
  if (i.bitDepth === 1) return true;
  return i.colorType === 3 && i.bitDepth <= 2;
}

/** zlib-inflate with a hard output cap, so a tiny hostile chunk cannot expand into gigabytes. */
function inflateCapped(data: Uint8Array, cap: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const z = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > cap) throw new ParseError("inflated chunk exceeds limit");
    parts.push(chunk);
  });
  const step = 16 * 1024;
  for (let i = 0; i < data.length; i += step) z.push(data.subarray(i, i + step), i + step >= data.length);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function pngHasAlphaChannel(i: PngInfo): boolean {
  return i.colorType === 4 || i.colorType === 6 || i.hasTrns;
}

export function pngColorModel(i: PngInfo): "rgb" | "gray" | "indexed" {
  if (i.colorType === 0 || i.colorType === 4) return "gray";
  if (i.colorType === 3) return "indexed";
  return "rgb";
}
