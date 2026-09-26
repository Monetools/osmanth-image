import { Reader } from "./bytes";
import type { IccInfo } from "./types";

/**
 * ICC profile reader: header colour space, description, and the RGB colorants.
 *
 * The sRGB decision is made from the rXYZ/gXYZ/bXYZ colorants, not from the profile name:
 * a renamed sRGB profile is still sRGB, and a profile that merely *says* "sRGB" while carrying
 * wide-gamut primaries is not. Names are only a fallback when colorants are absent.
 * (Approach adopted from the sibling CheckBeforeSubmit engine; implemented here on Osmanth Image's
 * bounds-checked Reader so a malformed profile cannot read out of range.)
 */

/** sRGB primaries as they appear D50-adapted in an ICC v2/v4 profile (rXYZ, gXYZ, bXYZ). */
const SRGB_COLORANTS: readonly (readonly [number, number, number])[] = [
  [0.4361, 0.2225, 0.0139],
  [0.3851, 0.7169, 0.0971],
  [0.1431, 0.0606, 0.7141],
];
const COLORANT_TOLERANCE = 0.01;

export function parseIcc(data: Uint8Array): IccInfo {
  const info: IccInfo = {
    colorSpace: "OTHER",
    description: null,
    sizeBytes: data.length,
    family: "Other",
    primariesMatchSrgb: undefined,
    readable: false,
  };
  try {
    const r = new Reader(data);
    // A real profile declares 'acsp' at byte 36; without it we are not looking at ICC data.
    if (data.length < 132 || r.ascii(36, 4) !== "acsp") return info;
    info.readable = true;
    const cs = r.ascii(16, 4);
    info.colorSpace = cs === "RGB " ? "RGB" : cs === "CMYK" ? "CMYK" : cs === "GRAY" ? "GRAY" : cs === "Lab " ? "LAB" : "OTHER";
    const count = Math.min(r.u32(128), 200);
    const tags = new Map<string, { off: number; size: number }>();
    for (let i = 0; i < count; i++) {
      const e = 132 + i * 12;
      if (e + 12 > data.length) break;
      tags.set(r.ascii(e, 4), { off: r.u32(e + 4), size: r.u32(e + 8) });
    }
    const desc = tags.get("desc");
    if (desc) info.description = readDescription(r, desc.off, desc.size);
    if (info.colorSpace === "RGB") info.primariesMatchSrgb = matchesSrgbPrimaries(r, tags);
    info.colorants = readColorants(r, tags);
  } catch {
    // Keep whatever was parsed; `readable` stays false and callers report "could not verify".
  }
  info.family = classifyIcc(info);
  return info;
}

function readDescription(r: Reader, off: number, size: number): string | null {
  try {
    const type = r.ascii(off, 4);
    if (type === "desc") {
      const n = Math.min(r.u32(off + 8), Math.max(0, size - 12));
      return r.ascii(off + 12, n).replace(/\0.*$/s, "").trim() || null;
    }
    if (type === "mluc") {
      if (r.u32(off + 8) < 1) return null;
      const len = r.u32(off + 20);
      const strOff = r.u32(off + 24);
      let s = "";
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(r.u16(off + strOff + k));
      return s.replace(/\0+$/, "").trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

/** s15Fixed16 number, as used by XYZType. */
function s15f16(r: Reader, o: number): number {
  return (r.u32(o) | 0) / 65536;
}

function readXyz(r: Reader, off: number): [number, number, number] | null {
  try {
    if (r.ascii(off, 4) !== "XYZ ") return null;
    return [s15f16(r, off + 8), s15f16(r, off + 12), s15f16(r, off + 16)];
  } catch {
    return null;
  }
}

function readColorants(r: Reader, tags: Map<string, { off: number; size: number }>) {
  const xyz = (["rXYZ", "gXYZ", "bXYZ"] as const).map((t) => {
    const tag = tags.get(t);
    return tag ? readXyz(r, tag.off) : null;
  });
  if (xyz.some((v) => v === null)) return undefined;
  return { r: xyz[0]!, g: xyz[1]!, b: xyz[2]! };
}

function matchesSrgbPrimaries(r: Reader, tags: Map<string, { off: number; size: number }>): boolean | undefined {
  const c = readColorants(r, tags);
  if (!c) return undefined;
  const rows = [c.r, c.g, c.b];
  return rows.every((row, i) => row.every((v, j) => Math.abs(v - SRGB_COLORANTS[i][j]) <= COLORANT_TOLERANCE));
}

function classifyIcc(i: IccInfo): IccInfo["family"] {
  if (i.colorSpace === "CMYK") return "CMYK";
  if (i.colorSpace === "GRAY") return "Gray";
  if (i.colorSpace === "LAB") return "Other";
  // Colorants are authoritative when we have them.
  if (i.primariesMatchSrgb === true) return "sRGB";
  const d = (i.description ?? "").toLowerCase();
  if (i.primariesMatchSrgb === false) {
    // The colorants prove it is not sRGB; naming which wide-gamut space it is relies on the
    // description (we do not keep a table of other spaces' primaries).
    if (d.includes("p3")) return "Display P3";
    if (d.includes("adobe rgb") || d.includes("adobergb")) return "Adobe RGB";
    if (d.includes("prophoto") || d.includes("romm")) return "ProPhoto RGB";
    return "Other";
  }
  if (d.includes("srgb") || d.includes("iec61966") || d.includes("iec 61966")) return "sRGB";
  if (d.includes("p3")) return "Display P3";
  if (d.includes("adobe rgb") || d.includes("adobergb") || d.includes("compatible with adobe")) return "Adobe RGB";
  if (d.includes("prophoto") || d.includes("romm")) return "ProPhoto RGB";
  return "Other";
}

/** True when the profile claims sRGB in its name but its colorants say otherwise. */
export function isMislabelledSrgb(i: IccInfo | null): boolean {
  if (!i || i.primariesMatchSrgb !== false) return false;
  return /srgb|iec\s?61966/i.test(i.description ?? "");
}
