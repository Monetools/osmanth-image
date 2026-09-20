import { zipSync } from "fflate";
import type { ImageInspection } from "../inspect/types";
import type { MarketplaceConstraints, PrintProfile, ProfileGroup } from "../profiles/schema";
import { ASPECT, effectivePpiFor } from "../preflight/geometry";
import { runPreflight, type PreflightResult } from "../preflight/preflight";
import { technicalTier, type TechnicalTier } from "../preflight/quality";
import { planFix, type FixPlan } from "../fix/planner";
import { toInches } from "../units";

/**
 * Etsy Printable Pack (spec §17) — a workflow over the SAME Profile/Preflight/Fix/Verify engines.
 * One file per ratio family; each file is checked against every nominal size it must serve.
 */
export interface PackSizeRow {
  label: string;
  effectivePpi: number;
  tier: TechnicalTier;
  ok: boolean;
}

export interface PackItemPlan {
  profile: PrintProfile;
  preflight: PreflightResult;
  plan: FixPlan;
  cropOffset: number;
  /** Fraction of the artwork this ratio's crop removes. */
  loss: number;
  /** Substantial content loss: the user must confirm or reposition before generation. */
  needsDecision: boolean;
  sizes: PackSizeRow[];
  /** Largest family size that still meets the minimum PPI; null = none. */
  largestGoodSize: string | null;
  fileName: string;
}

export interface PackPlan {
  items: PackItemPlan[];
  pendingDecisions: number;
  constraints: MarketplaceConstraints | undefined;
}

export function sanitizeFileName(base: string, suffix: string, ext: string, maxLen = 70): string {
  const clean = base
    .replace(/\.[A-Za-z0-9]+$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "artwork";
  const tail = `_${suffix}.${ext}`;
  return clean.slice(0, Math.max(1, maxLen - tail.length)) + tail;
}

export function planEtsyPack(
  img: ImageInspection,
  group: ProfileGroup,
  offsets: Record<string, number> = {},
  confirmed: Record<string, boolean> = {},
): PackPlan {
  const items = group.profiles.map((profile): PackItemPlan => {
    const cropOffset = offsets[profile.id] ?? 0;
    const preflight = runPreflight({ inspection: img, profile, cropOffset, aspectMode: "crop" });
    const plan = planFix(img, profile, preflight, { aspectMode: "crop", cropOffset });
    const landscape = preflight.target.landscape;
    const sizes = (profile.ratio_family?.sizes ?? []).map((s) => {
      const w = toInches(landscape ? s.height : s.width, s.unit);
      const h = toInches(landscape ? s.width : s.height, s.unit);
      const ppi = effectivePpiFor(preflight.crop.w, preflight.crop.h, w, h);
      const tier = technicalTier(ppi, profile);
      return { label: s.label, effectivePpi: ppi, tier, ok: ppi >= profile.ppi.minimum - 0.5 };
    });
    const good = sizes.filter((s) => s.ok);
    const suffix = profile.ratio_family?.label.startsWith("ISO") ? "ISO-A" : (profile.ratio_family?.label ?? profile.id).replace(":", "x");
    const loss = preflight.crop.loss;
    return {
      profile, preflight, plan, cropOffset, loss,
      needsDecision: loss > ASPECT.substantialLoss && !confirmed[profile.id],
      sizes,
      largestGoodSize: good.length ? good[good.length - 1].label : null,
      fileName: sanitizeFileName(img.fileName, suffix, profile.output_format === "jpeg" ? "jpg" : "png",
        group.marketplace_constraints?.filename_max_length ?? 70),
    };
  });
  return { items, pendingDecisions: items.filter((i) => i.needsDecision).length, constraints: group.marketplace_constraints };
}

export interface PackFile {
  name: string;
  bytes: Uint8Array;
}

export interface PackUpload {
  name: string;
  bytes: Uint8Array;
  contains: string[];
}

export class PackError extends Error {}

/**
 * Group generated files into listing uploads that respect the marketplace constraints
 * (max files per listing, max bytes per file). Files that fit individually are uploaded as-is;
 * otherwise they are bundled into ZIPs (first-fit decreasing).
 */
export function packageUploads(files: PackFile[], c: MarketplaceConstraints, baseName: string): PackUpload[] {
  const re = new RegExp(c.filename_allowed);
  for (const f of files) {
    if (f.bytes.length > c.max_file_size_bytes) throw new PackError(`${f.name} is larger than the ${c.max_file_size_bytes} byte limit`);
    if (!re.test(f.name) || f.name.length > c.filename_max_length) throw new PackError(`${f.name} is not a valid marketplace filename`);
  }
  if (files.length <= c.max_files_per_listing) {
    return files.map((f) => ({ name: f.name, bytes: f.bytes, contains: [f.name] }));
  }
  // ZIP overhead per entry is small (~100 bytes); JPEG/PNG data is stored, not recompressed.
  const overhead = (n: number) => 22 + n * 120;
  const bins: PackFile[][] = [];
  const sorted = [...files].sort((a, b) => b.bytes.length - a.bytes.length);
  for (const f of sorted) {
    const bin = bins.find((b) => b.reduce((n, x) => n + x.bytes.length + x.name.length * 2, 0) + f.bytes.length + overhead(b.length + 1) <= c.max_file_size_bytes);
    if (bin) bin.push(f);
    else bins.push([f]);
  }
  if (bins.length > c.max_files_per_listing) {
    throw new PackError(`These files need ${bins.length} uploads, but a listing allows ${c.max_files_per_listing}. Reduce file sizes or ratios.`);
  }
  return bins.map((bin, i) => {
    const name = sanitizeFileName(baseName, bins.length === 1 ? "print-pack" : `print-pack-${i + 1}`, "zip", c.filename_max_length);
    const bytes = zipSync(Object.fromEntries(bin.map((f) => [f.name, [f.bytes, { level: 0 }]])));
    if (bytes.length > c.max_file_size_bytes) throw new PackError(`${name} exceeded the size limit after zipping`);
    return { name, bytes, contains: bin.map((f) => f.name) };
  });
}

/** A single archive of everything, for the seller's own download. */
export function zipAll(files: PackFile[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, [f.bytes, { level: 0 }]])));
}
