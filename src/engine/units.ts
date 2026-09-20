import type { LengthUnit } from "./profiles/schema";

export const MM_PER_INCH = 25.4;

export function toInches(value: number, unit: LengthUnit): number {
  return unit === "mm" ? value / MM_PER_INCH : value;
}

/** Pixels needed to cover `inches` at `ppi`, rounded to the nearest whole pixel. */
export function pixelsFor(inches: number, ppi: number): number {
  return Math.round(inches * ppi);
}

/** Effective PPI of `pixels` spread across `inches`. */
export function effectivePpi(pixels: number, inches: number): number {
  if (!(inches > 0)) throw new RangeError("inches must be > 0");
  return pixels / inches;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Human-readable ratio for pixel dimensions, snapping to common print ratios within 1%. */
export function describeRatio(width: number, height: number): string {
  const common: [number, number][] = [
    [1, 1], [2, 3], [3, 4], [4, 5], [5, 7], [11, 14], [9, 16], [1, 1.4142],
  ];
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const r = short / long;
  for (const [a, b] of common) {
    if (Math.abs(r - a / b) / (a / b) < 0.01) {
      if (b === 1.4142) return "ISO A (1:√2)";
      return width <= height ? `${a}:${b}` : `${b}:${a}`;
    }
  }
  return `${(long / short).toFixed(2)}:1`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Describe a published upload limit. When a platform writes "200MB" without saying whether it
 * means 200,000,000 or 200 x 1024 x 1024 bytes, show the published figure and say which reading we
 * apply — never a converted number the user cannot find on the platform's page.
 */
export function describeLimit(lower: number, upper?: number | null): string {
  if (!upper || upper === lower) return formatBytes(lower);
  const published = Math.round(upper / 1024 / 1024);
  return `${published} MB as published (we apply the stricter reading, ${lower.toLocaleString("en-US")} bytes)`;
}

export function formatInches(inches: number): string {
  return `${Math.round(inches * 10) / 10}″`;
}
