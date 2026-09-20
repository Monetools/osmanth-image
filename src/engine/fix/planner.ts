import type { ImageInspection } from "../inspect/types";
import type { OutputFormat, PrintProfile } from "../profiles/schema";
import { effectivePpiFor } from "../preflight/geometry";
import type { PreflightResult } from "../preflight/preflight";

/**
 * A fully-resolved description of the output file. The browser renderer (src/browser/render.ts)
 * executes it; the Verification Engine checks the ACTUAL output against `expected`, never against
 * what was requested.
 */
export interface RenderSpec {
  /** Rectangle of the upright (orientation-applied) source image to use. */
  source: { x: number; y: number; w: number; h: number };
  canvas: { w: number; h: number };
  /** Where the source is drawn on the canvas (differs from full canvas only in "fit" mode). */
  draw: { x: number; y: number; w: number; h: number };
  /** Fill colour behind the image; null keeps transparency (PNG only). */
  background: string | null;
  format: OutputFormat;
  /** 0–1 encoder quality for JPEG. */
  jpegQuality: number;
  /** PPI written into file metadata = canvas pixels ÷ physical inches. Informational only. */
  ppi: number;
  maxBytes: number | null;
  /** Light unsharp mask after a strong downscale. 0 = off. */
  sharpen: number;
  /** Physical size the canvas covers, for verification. */
  inches: { w: number; h: number };
}

export interface FixStep {
  kind: "orient" | "crop" | "fit" | "resize" | "flatten" | "color" | "convert" | "metadata" | "compress" | "enhance";
  tier: "local" | "ai";
  label: string;
}

export interface AiRecommendation {
  /** Upscale factor the router should request (2 or 4). */
  scale: 2 | 4;
  reason: string;
  /** Source pixels that would be sent (the crop), and resulting output pixels. */
  inputPixels: { w: number; h: number };
  outputPixels: { w: number; h: number };
}

export interface FixPlan {
  spec: RenderSpec;
  steps: FixStep[];
  ai: AiRecommendation | null;
}

export interface FixChoices {
  aspectMode: "crop" | "fit";
  cropOffset: number;
  sharpen?: boolean;
}

export const DEFAULT_JPEG_QUALITY = 0.92;

export function planFix(img: ImageInspection, profile: PrintProfile, pre: PreflightResult, choices: FixChoices): FixPlan {
  const t = pre.target;
  const steps: FixStep[] = [];
  const flatten = profile.transparency === "flatten_to_white" || profile.output_format === "jpeg";
  let spec: RenderSpec;

  if (img.orientation !== 1) steps.push({ kind: "orient", tier: "local", label: "Rotate the photo upright" });

  if (choices.aspectMode === "fit" && pre.crop.axis !== "none") {
    const ppiNative = effectivePpiFor(img.width, img.height, t.fullW, t.fullH);
    const ppi = Math.min(profile.ppi.preferred, ppiNative);
    const cw = Math.round(t.fullW * ppi);
    const ch = Math.round(t.fullH * ppi);
    const s = Math.min(cw / img.width, ch / img.height);
    const dw = Math.min(cw, Math.round(img.width * s));
    const dh = Math.min(ch, Math.round(img.height * s));
    spec = baseSpec(profile, flatten, { x: 0, y: 0, w: img.width, h: img.height }, cw, ch, t);
    spec.draw = { x: Math.floor((cw - dw) / 2), y: Math.floor((ch - dh) / 2), w: dw, h: dh };
    spec.background = "#ffffff";
    steps.push({ kind: "fit", tier: "local", label: "Keep the whole image and add white borders" });
  } else {
    const c = pre.crop;
    const ppiNative = effectivePpiFor(c.w, c.h, t.fullW, t.fullH);
    const ppi = Math.min(profile.ppi.preferred, ppiNative);
    // At or below native resolution the canvas matches the crop pixel-for-pixel (no invented pixels).
    const native = ppi < profile.ppi.preferred;
    const cw = native ? c.w : Math.round(t.fullW * ppi);
    const ch = native ? c.h : Math.round(t.fullH * ppi);
    spec = baseSpec(profile, flatten, { x: c.x, y: c.y, w: c.w, h: c.h }, cw, ch, t);
    if (c.axis !== "none") steps.push({ kind: "crop", tier: "local", label: `Crop to the print shape (${(c.loss * 100).toFixed(1)}% trimmed)` });
  }

  const downscale = spec.source.w / spec.draw.w;
  if (downscale > 1.01) steps.push({ kind: "resize", tier: "local", label: `Resize to ${spec.canvas.w} × ${spec.canvas.h} pixels` });
  if (choices.sharpen && downscale >= 1.5) {
    spec.sharpen = 0.35;
    steps.push({ kind: "resize", tier: "local", label: "Apply light sharpening after resizing" });
  }
  if (flatten && img.hasAlphaChannel) steps.push({ kind: "flatten", tier: "local", label: "Fill transparent areas with white" });
  if (img.colorModel === "cmyk" || img.colorModel === "ycck" || (img.icc && img.icc.family !== "sRGB" && img.icc.family !== "Gray")) {
    steps.push({ kind: "color", tier: "local", label: "Convert colours to standard sRGB" });
  }
  if (img.format !== profile.output_format) steps.push({ kind: "convert", tier: "local", label: `Save as ${profile.output_format.toUpperCase()}` });
  steps.push({ kind: "metadata", tier: "local", label: `Set the print-size tag to ${Math.round(spec.ppi)} PPI (does not change quality)` });
  if (spec.maxBytes) steps.push({ kind: "compress", tier: "local", label: "Keep the file under the upload limit" });

  return { spec, steps, ai: recommendAi(pre, spec) };
}

function baseSpec(
  profile: PrintProfile,
  flatten: boolean,
  source: RenderSpec["source"],
  cw: number,
  ch: number,
  t: PreflightResult["target"],
): RenderSpec {
  return {
    source,
    canvas: { w: cw, h: ch },
    draw: { x: 0, y: 0, w: cw, h: ch },
    background: flatten ? "#ffffff" : null,
    format: profile.output_format,
    jpegQuality: DEFAULT_JPEG_QUALITY,
    ppi: cw / t.fullW,
    maxBytes: profile.max_file_size_bytes,
    sharpen: 0,
    inches: { w: t.fullW, h: t.fullH },
  };
}

function recommendAi(pre: PreflightResult, spec: RenderSpec): AiRecommendation | null {
  const q = pre.quality;
  if (q.technical !== "low" && q.technical !== "very_low") return null;
  const scale: 2 | 4 = q.scaleToPreferred <= 2 ? 2 : 4;
  return {
    scale,
    reason:
      `To look crisp at this size the image needs about ${q.scaleToPreferred.toFixed(1)}× more pixels across and down.` +
      (scale === 4 ? " Enlarging this much can look artificial." : ""),
    inputPixels: { w: spec.source.w, h: spec.source.h },
    outputPixels: { w: spec.source.w * scale, h: spec.source.h * scale },
  };
}
