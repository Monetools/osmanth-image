/**
 * Hard input limits. Checked against HEADER dimensions before any decode, so a decompression bomb
 * (tiny file, gigantic pixel count) is rejected without allocating its pixels.
 */
export const LIMITS = {
  maxFileBytes: 80 * 1024 * 1024,
  /** 120 MP ≈ 480 MB of RGBA once decoded. */
  maxPixels: 120_000_000,
  maxDimension: 30_000,
  /** Minimum useful input. */
  minDimension: 16,
  /** Upper bound for anything the browser is asked to render into a single canvas. */
  maxCanvasPixels: 100_000_000,
  /** Server-side enhancement job limits (see src/engine/enhance). */
  serverJobTimeoutMs: 120_000,
  serverMaxInputPixels: 25_000_000,
  tempRetentionMinutes: 30,
} as const;

export type LimitViolation =
  | { code: "file_too_large"; limit: number; actual: number }
  | { code: "too_many_pixels"; limit: number; actual: number }
  | { code: "dimension_too_large"; limit: number; actual: number }
  | { code: "too_small"; limit: number; actual: number };

export function checkLimits(fileBytes: number, width: number, height: number): LimitViolation | null {
  if (fileBytes > LIMITS.maxFileBytes) return { code: "file_too_large", limit: LIMITS.maxFileBytes, actual: fileBytes };
  const maxDim = Math.max(width, height);
  if (maxDim > LIMITS.maxDimension) return { code: "dimension_too_large", limit: LIMITS.maxDimension, actual: maxDim };
  const px = width * height;
  if (px > LIMITS.maxPixels) return { code: "too_many_pixels", limit: LIMITS.maxPixels, actual: px };
  const minDim = Math.min(width, height);
  if (minDim < LIMITS.minDimension) return { code: "too_small", limit: LIMITS.minDimension, actual: minDim };
  return null;
}
