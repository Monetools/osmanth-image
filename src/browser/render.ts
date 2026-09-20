"use client";

import type { RenderSpec } from "@/engine/fix/planner";
import { setPpi } from "@/engine/fix/metadata";
import { LIMITS } from "@/engine/security/limits";

/**
 * Browser-local execution of a RenderSpec (spec §7.1, §11): decode → orient → crop → resize →
 * flatten → encode → write print-size tag. Nothing is uploaded.
 *
 * Colour: createImageBitmap with colorSpaceConversion "default" lets the browser's colour
 * management convert embedded ICC profiles (incl. CMYK JPEGs) into the sRGB canvas. The output is
 * untagged sRGB. This is the "simple, technically reliable" path; LittleCMS-based server
 * conversion is documented as the upgrade path in PRINTREADY_ARCHITECTURE.md.
 */

export class RenderError extends Error {}

export async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image", colorSpaceConversion: "default" });
  } catch {
    throw new RenderError("Your browser couldn't open this image. It may be damaged or in an unusual format.");
  }
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (w * h > LIMITS.maxCanvasPixels) {
    throw new RenderError(`The output (${w}×${h}) is too large to create in the browser.`);
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: OffscreenCanvas | HTMLCanvasElement, alpha: boolean) {
  const ctx = c.getContext("2d", { alpha, colorSpace: "srgb" }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new RenderError("This device ran out of memory creating the image. Try a smaller print size, or use a desktop browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/**
 * Downscale in ≤2× steps: a single large browser downscale aliases badly (moire, jaggies).
 */
function drawStepped(
  src: ImageBitmap | OffscreenCanvas | HTMLCanvasElement,
  sx: number, sy: number, sw: number, sh: number,
  dst: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dx: number, dy: number, dw: number, dh: number,
): void {
  let cur: ImageBitmap | OffscreenCanvas | HTMLCanvasElement = src;
  let cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / dw > 2 && ch / dh > 2) {
    const nw = Math.max(dw, Math.ceil(cw / 2));
    const nh = Math.max(dh, Math.ceil(ch / 2));
    const tmp = makeCanvas(nw, nh);
    const t = ctx2d(tmp, true);
    t.drawImage(cur as CanvasImageSource, cx, cy, cw, ch, 0, 0, nw, nh);
    cur = tmp;
    cx = 0; cy = 0; cw = nw; ch = nh;
  }
  dst.drawImage(cur as CanvasImageSource, cx, cy, cw, ch, dx, dy, dw, dh);
}

/** Mild unsharp mask (3×3) blended by `amount`. Applied only after strong downscales. */
function sharpen(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const s = img.data;
  const out = new Uint8ClampedArray(s);
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (s[i - row + c] + s[i + row + c] + s[i - 4 + c] + s[i + 4 + c]) / 4;
        out[i + c] = s[i + c] + amount * (s[i + c] - blur) * 2;
      }
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

async function encode(c: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new RenderError("Encoding failed"))), type, quality));
}

/** True if any pixel is not fully opaque. Scans every pixel of the given bitmap. */
export function alphaUsed(bitmap: ImageBitmap): boolean {
  const maxSide = 2048;
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c, true);
  // Scaling down averages alpha, so any transparent region survives as alpha < 255.
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

export interface RenderOutput {
  bytes: Uint8Array;
  spec: RenderSpec;
  mime: string;
  /** Adjustments made to fit constraints, in plain language. */
  notes: string[];
}

const QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8];

export async function renderSpec(bitmap: ImageBitmap, requested: RenderSpec): Promise<RenderOutput> {
  let spec = { ...requested, canvas: { ...requested.canvas }, draw: { ...requested.draw } };
  const notes: string[] = [];
  const mime = spec.format === "jpeg" ? "image/jpeg" : "image/png";

  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = makeCanvas(spec.canvas.w, spec.canvas.h);
    const ctx = ctx2d(canvas, spec.background === null);
    if (spec.background) {
      ctx.fillStyle = spec.background;
      ctx.fillRect(0, 0, spec.canvas.w, spec.canvas.h);
    }
    const { source: s, draw: d } = spec;
    drawStepped(bitmap, s.x, s.y, s.w, s.h, ctx, d.x, d.y, d.w, d.h);
    if (spec.sharpen > 0) sharpen(ctx, spec.canvas.w, spec.canvas.h, spec.sharpen);

    const qualities = spec.format === "jpeg" && spec.maxBytes ? QUALITY_STEPS : [spec.jpegQuality];
    for (const q of qualities) {
      const blob = await encode(canvas, mime, q);
      if (!spec.maxBytes || blob.size <= spec.maxBytes) {
        const raw = new Uint8Array(await blob.arrayBuffer());
        if (q !== spec.jpegQuality) notes.push(`Saved at a slightly higher compression to stay under the upload limit.`);
        spec = { ...spec, jpegQuality: q };
        return { bytes: setPpi(raw, spec.format, spec.ppi), spec, mime, notes };
      }
    }
    // Still too big: reduce pixel dimensions by 10% (this lowers effective PPI; verification re-checks it).
    const f = 0.9;
    const cw = Math.round(spec.canvas.w * f);
    const ch = Math.round(spec.canvas.h * f);
    spec = {
      ...spec,
      canvas: { w: cw, h: ch },
      draw: { x: Math.round(spec.draw.x * f), y: Math.round(spec.draw.y * f), w: Math.min(cw, Math.round(spec.draw.w * f)), h: Math.min(ch, Math.round(spec.draw.h * f)) },
      ppi: cw / spec.inches.w,
    };
    notes.push(`Reduced to ${cw}×${ch} pixels to stay under the upload limit.`);
  }
  throw new RenderError("Couldn't make the file small enough for this destination's upload limit.");
}

/** Decode a produced file and report whether it actually contains transparent pixels. */
export async function outputAlphaUsed(bytes: Uint8Array, mime: string): Promise<boolean> {
  if (mime === "image/jpeg") return false;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  try {
    return alphaUsed(bmp);
  } finally {
    bmp.close();
  }
}
