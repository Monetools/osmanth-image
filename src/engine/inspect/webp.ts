import { ParseError, Reader } from "./bytes";
import { parseExifTiff, type ExifInfo } from "./exif";
import { parseIcc } from "./icc";
import type { IccInfo } from "./types";

export interface WebpInfo {
  width: number;
  height: number;
  hasAlpha: boolean;
  lossless: boolean;
  animated: boolean;
  icc: IccInfo | null;
  exif: ExifInfo | null;
}

export function parseWebp(bytes: Uint8Array): WebpInfo {
  const r = new Reader(bytes, true);
  if (r.ascii(0, 4) !== "RIFF" || r.ascii(8, 4) !== "WEBP") throw new ParseError("not a WebP");
  const info: WebpInfo = { width: 0, height: 0, hasAlpha: false, lossless: false, animated: false, icc: null, exif: null };
  let o = 12;
  let guard = 0;
  while (o + 8 <= bytes.length && guard++ < 10000) {
    const type = r.ascii(o, 4);
    const len = r.u32(o + 4);
    const d = o + 8;
    r.check(d, Math.min(len, bytes.length - d));
    if (type === "VP8X") {
      const flags = r.u8(d);
      info.hasAlpha = (flags & 0x10) !== 0;
      info.animated = (flags & 0x02) !== 0;
      info.width = 1 + (r.u8(d + 4) | (r.u8(d + 5) << 8) | (r.u8(d + 6) << 16));
      info.height = 1 + (r.u8(d + 7) | (r.u8(d + 8) << 8) | (r.u8(d + 9) << 16));
    } else if (type === "VP8 " && !info.width) {
      info.width = r.u16(d + 6) & 0x3fff;
      info.height = r.u16(d + 8) & 0x3fff;
    } else if (type === "VP8L") {
      info.lossless = true;
      if (!info.width) {
        const b = r.u32(d + 1);
        info.width = (b & 0x3fff) + 1;
        info.height = ((b >>> 14) & 0x3fff) + 1;
        info.hasAlpha = ((b >>> 28) & 1) === 1;
      }
    } else if (type === "ALPH") {
      info.hasAlpha = true;
    } else if (type === "ICCP") {
      info.icc = parseIcc(r.slice(d, len));
    } else if (type === "EXIF") {
      try {
        let ex = r.slice(d, len);
        if (ex.length > 6 && String.fromCharCode(...ex.subarray(0, 4)) === "Exif") ex = ex.subarray(6);
        info.exif = parseExifTiff(ex);
      } catch {
        info.exif = null;
      }
    }
    o = d + len + (len & 1);
  }
  if (!info.width || !info.height) throw new ParseError("WebP has no dimensions");
  return info;
}
