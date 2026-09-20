import { Reader } from "./bytes";

export interface ExifInfo {
  orientation: number | null;
  /** Exif sub-IFD ColorSpace tag: 1 = sRGB, 65535 = uncalibrated. */
  colorSpace: number | null;
  xResolution: number | null;
  yResolution: number | null;
  /** 2 = inch, 3 = centimetre, 1 = none */
  resolutionUnit: number | null;
}

/** Parse the IFD0 tags PrintReady needs from a TIFF-structured EXIF block (starting at "II"/"MM"). */
export function parseExifTiff(tiff: Uint8Array): ExifInfo {
  const out: ExifInfo = { orientation: null, colorSpace: null, xResolution: null, yResolution: null, resolutionUnit: null };
  const r = new Reader(tiff);
  const bo = r.ascii(0, 2);
  if (bo !== "II" && bo !== "MM") return out;
  r.littleEndian = bo === "II";
  if (r.u16(2) !== 42) return out;
  const ifd = r.u32(4);
  const n = Math.min(r.u16(ifd), 512);
  const rational = (off: number) => {
    const den = r.u32(off + 4);
    return den ? r.u32(off) / den : null;
  };
  let exifIfd: number | null = null;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    if (tag === 0x8769 && type === 4) exifIfd = r.u32(e + 8);
    else if (tag === 0x0112 && type === 3) out.orientation = r.u16(e + 8);
    else if (tag === 0x0128 && type === 3) out.resolutionUnit = r.u16(e + 8);
    else if ((tag === 0x011a || tag === 0x011b) && type === 5) {
      const v = rational(r.u32(e + 8));
      if (tag === 0x011a) out.xResolution = v;
      else out.yResolution = v;
    }
  }
  if (exifIfd !== null) {
    try {
      const m = Math.min(r.u16(exifIfd), 512);
      for (let i = 0; i < m; i++) {
        const e = exifIfd + 2 + i * 12;
        if (r.u16(e) === 0xa001 && r.u16(e + 2) === 3) out.colorSpace = r.u16(e + 8);
      }
    } catch {
      out.colorSpace = null; // a broken sub-IFD must not lose the IFD0 facts above
    }
  }
  if (out.orientation !== null && (out.orientation < 1 || out.orientation > 8)) out.orientation = null;
  return out;
}

export function exifPpi(e: ExifInfo): { x: number; y: number } | null {
  if (!e.xResolution || !e.yResolution) return null;
  const unit = e.resolutionUnit ?? 2;
  if (unit === 2) return { x: e.xResolution, y: e.yResolution };
  if (unit === 3) return { x: e.xResolution * 2.54, y: e.yResolution * 2.54 };
  return null;
}
