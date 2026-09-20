import type { PrintProfile } from "../profiles/schema";
import { toInches } from "../units";

/** Physical target in inches, oriented to match the image, including any bleed. */
export interface Target {
  /** Finished (trim) size. */
  trimW: number;
  trimH: number;
  /**
   * Bleed added on each edge of the file, in inches, after orientation. Sides the profile does not
   * trim stay 0, so nothing is added — and nothing is reported — where it does not apply.
   */
  bleed: { top: number; right: number; bottom: number; left: number };
  /** Largest single-side bleed, for wording. */
  maxBleed: number;
  /** Full canvas the file must cover = trim + bleed on the relevant sides. */
  fullW: number;
  fullH: number;
  landscape: boolean;
  /** Safe-area inset from the trim edge. */
  safe: number;
}

export function resolveTarget(profile: PrintProfile, imageW: number, imageH: number): Target {
  const w = toInches(profile.size.width, profile.size.unit);
  const h = toInches(profile.size.height, profile.size.unit);
  const landscape = profile.rotatable && imageW > imageH;
  const trimW = landscape ? h : w;
  const trimH = landscape ? w : h;
  const safe = profile.safe_area ? toInches(profile.safe_area.value, profile.safe_area.unit) : 0;

  // Per-side bleed. On a single-sheet print there is no binding, so the profile's "inside" edge is
  // the left one and "outside" the right; a rotated (landscape) target turns the sheet 90° clockwise.
  const v = profile.bleed ? toInches(profile.bleed.value, profile.bleed.unit) : 0;
  const sides = profile.bleed?.sides;
  const portrait = {
    top: sides?.top ? v : 0,
    right: sides?.outside ? v : 0,
    bottom: sides?.bottom ? v : 0,
    left: sides?.inside ? v : 0,
  };
  const bleed = landscape
    ? { top: portrait.left, right: portrait.top, bottom: portrait.right, left: portrait.bottom }
    : portrait;
  const maxBleed = Math.max(bleed.top, bleed.right, bleed.bottom, bleed.left);
  return {
    trimW, trimH, bleed, maxBleed,
    fullW: trimW + bleed.left + bleed.right,
    fullH: trimH + bleed.top + bleed.bottom,
    landscape, safe,
  };
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which image axis is being trimmed. */
  axis: "x" | "y" | "none";
  /** Fraction of the image area removed, 0–1. */
  loss: number;
}

/**
 * Largest rectangle of `ratio` (width/height) inside the image. `offset` in [-1, 1] slides the
 * crop along the trimmed axis (-1 = left/top, 0 = centre, 1 = right/bottom). Never stretches.
 */
export function cropToRatio(imageW: number, imageH: number, ratio: number, offset = 0): CropRect {
  const o = Math.max(-1, Math.min(1, offset));
  const imgRatio = imageW / imageH;
  if (Math.abs(imgRatio - ratio) / ratio < 1e-9) return { x: 0, y: 0, w: imageW, h: imageH, axis: "none", loss: 0 };
  if (imgRatio > ratio) {
    const w = Math.max(1, Math.min(imageW, Math.round(imageH * ratio)));
    const x = Math.round(((imageW - w) / 2) * (1 + o));
    return { x, y: 0, w, h: imageH, axis: "x", loss: 1 - w / imageW };
  }
  const h = Math.max(1, Math.min(imageH, Math.round(imageW / ratio)));
  const y = Math.round(((imageH - h) / 2) * (1 + o));
  return { x: 0, y, w: imageW, h, axis: "y", loss: 1 - h / imageH };
}

/** Effective PPI when `pxW × pxH` pixels cover `inW × inH` inches. The weaker axis wins. */
export function effectivePpiFor(pxW: number, pxH: number, inW: number, inH: number): number {
  return Math.min(pxW / inW, pxH / inH);
}

/** Largest print (long × short inches) the image supports at `ppi`, keeping its own aspect ratio. */
export function maxPrintSize(imageW: number, imageH: number, ppi: number): { w: number; h: number } {
  return { w: imageW / ppi, h: imageH / ppi };
}

/** Aspect-ratio mismatch thresholds on the fraction of image area a crop would remove. */
export const ASPECT = {
  /** Below this, the image is treated as already matching (≈ rounding). */
  matchLoss: 0.005,
  /** Up to this, an automatic centred trim is acceptable and shown in the preview. */
  autoTrimLoss: 0.05,
  /** Above this, losing content is "substantial" for Etsy pack decisions. */
  substantialLoss: 0.2,
} as const;
