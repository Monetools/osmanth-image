import { inspectImage } from "../inspect/inspect";
import type { ImageInspection } from "../inspect/types";
import type { RenderSpec } from "../fix/planner";
import type { PrintProfile } from "../profiles/schema";
import { effectivePpiFor } from "../preflight/geometry";
import { assessQuality, type PpiThresholds, type QualityAssessment, type SourceSignals } from "../preflight/quality";
import type { PrintStatus } from "../preflight/preflight";
import { describeLimit, formatBytes } from "../units";

/**
 * Verification Engine (spec §16). Re-opens the ACTUAL output bytes and checks them against the
 * destination rules. The requested transformation is never trusted.
 */
export interface VerificationCheck {
  name: string;
  /**
   * passed / failed / could_not_verify. `passed` stays a boolean for callers that only care
   * whether anything is wrong; `could_not_verify` is never counted as a pass.
   */
  state: "passed" | "failed" | "could_not_verify";
  passed: boolean;
  expected: string;
  actual: string;
  /** Why the result could not be decided (only for could_not_verify). */
  note?: string;
}

export interface VerificationResult {
  verified: boolean;
  status: PrintStatus;
  /** The only sanctioned final labels (spec §16). */
  label: string;
  checks: VerificationCheck[];
  inspection: ImageInspection | null;
  quality: QualityAssessment | null;
  notes: string[];
}

export interface VerifyContext {
  /** Measured by decoding the output: does any pixel use transparency? null = not measured. */
  outputAlphaUsed: boolean | null;
  /** Signals about the ORIGINAL source (compression, softness) — carried into the quality model. */
  source: SourceSignals;
  /** Colours were converted from CMYK or a wide-gamut profile by the browser. */
  colorConverted: boolean;
  /** PPI thresholds the preflight actually used (raised for line art on some products). */
  thresholds?: PpiThresholds;
}

/** Name of the resolution check. Compared in code, so it lives in one place. */
export const RESOLUTION_CHECK = "Resolution at this size";

export const READY_LABEL = "Ready for selected print target";
export const REVIEW_LABEL = "Technically compatible — Visual review recommended";

export function verifyOutput(
  bytes: Uint8Array,
  fileName: string,
  profile: PrintProfile,
  spec: RenderSpec,
  ctx: VerifyContext,
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const notes: string[] = [];
  const { inspection: out, error } = inspectImage(bytes, fileName);
  if (!out || error) {
    return {
      verified: false, status: "UNVERIFIED", label: "Output could not be verified", inspection: out, quality: null,
      checks: [{ name: "Readable output", state: "failed", passed: false, expected: "a valid image file", actual: error?.message ?? "unreadable" }],
      notes,
    };
  }
  const add = (name: string, passed: boolean, expected: string, actual: string) =>
    checks.push({ name, state: passed ? "passed" : "failed", passed, expected, actual });
  const undecided = (name: string, expected: string, actual: string, note: string) =>
    checks.push({ name, state: "could_not_verify", passed: false, expected, actual, note });

  add("Pixel dimensions", out.width === spec.canvas.w && out.height === spec.canvas.h,
    `${spec.canvas.w} × ${spec.canvas.h}`, `${out.width} × ${out.height}`);

  const wantRatio = spec.inches.w / spec.inches.h;
  const gotRatio = out.width / out.height;
  // One pixel of rounding on the short side is the most any exact-ratio render can be off.
  const ratioTol = 1.01 / Math.min(out.width, out.height);
  add("Aspect ratio", Math.abs(gotRatio - wantRatio) / wantRatio <= ratioTol,
    wantRatio.toFixed(4), gotRatio.toFixed(4));

  add("File format", out.format === profile.output_format && profile.accepted_formats.includes(out.format as never),
    profile.output_format.toUpperCase(), out.format.toUpperCase());

  if (profile.max_file_size_bytes !== null) {
    const upper = profile.max_file_size_bytes_upper ?? profile.max_file_size_bytes;
    if (out.fileSizeBytes > profile.max_file_size_bytes && out.fileSizeBytes <= upper) {
      // The destination's published limit can be read two ways and this file lands between them.
      undecided("File size", `≤ ${describeLimit(profile.max_file_size_bytes, upper)}`, formatBytes(out.fileSizeBytes),
        "The published limit can mean either of two byte counts, and this file is between them.");
    } else {
      add("File size", out.fileSizeBytes <= profile.max_file_size_bytes,
        `≤ ${describeLimit(profile.max_file_size_bytes, upper)}`, formatBytes(out.fileSizeBytes));
    }
  }

  const colorOk = out.colorModel === "rgb" || out.colorModel === "gray" ? !out.icc || out.icc.family === "sRGB" : false;
  add("Colour", colorOk, "sRGB (or untagged, treated as sRGB)",
    `${out.colorModel.toUpperCase()}${out.icc ? ` / ${out.icc.family}` : " / untagged"}`);

  if (profile.transparency === "flatten_to_white") {
    const passed = !out.hasAlphaChannel || ctx.outputAlphaUsed === false;
    add("No transparency", passed, "fully opaque", out.hasAlphaChannel ? (ctx.outputAlphaUsed === false ? "alpha channel, unused" : "transparent pixels") : "opaque");
  }

  add("Upright orientation", out.orientation === 1, "no rotation tag", `orientation ${out.orientation}`);
  add("Complete file", out.complete, "ends properly", out.complete ? "complete" : "truncated");

  const ppi = effectivePpiFor(out.width, out.height, spec.inches.w, spec.inches.h);
  const embedded = out.embeddedPpi?.x ?? null;
  add("Print-size tag", embedded !== null && Math.abs(embedded - ppi) <= 1,
    `${Math.round(ppi)} PPI`, embedded === null ? "missing" : `${Math.round(embedded)} PPI`);

  // Effective PPI is recomputed from the output's own pixels, not taken from the plan.
  const thresholds = ctx.thresholds ?? profile.ppi;
  const quality = assessQuality(profile, ppi, ctx.source, thresholds);
  const ppiOk = ppi >= thresholds.minimum - 0.5;
  add(RESOLUTION_CHECK, ppiOk, `≥ ${Math.round(thresholds.minimum)} PPI`, `${Math.round(ppi)} PPI`);

  const hardFail = checks.some((c) => c.state === "failed" && c.name !== RESOLUTION_CHECK);
  const undecidedChecks = checks.filter((c) => c.state === "could_not_verify");
  let status: PrintStatus;
  let label: string;
  if (hardFail) {
    status = "UNVERIFIED";
    label = "Output failed verification — do not use it for printing";
  } else if (!ppiOk) {
    status = quality.technical === "unusable" ? "NOT_RECOMMENDED" : "REVIEW_RECOMMENDED";
    label = "File is valid, but it has too little detail for this size";
    notes.push("The file meets the technical rules, but the image may look soft or pixelated at this size.");
  } else {
    const needsReview =
      undecidedChecks.length > 0 ||
      quality.technical === "acceptable" ||
      quality.source === "poor" ||
      quality.source === "fair" ||
      ctx.colorConverted ||
      profile.source.review_required ||
      profile.constraints_source?.review_required === true;
    status = needsReview ? "READY_WITH_WARNINGS" : "READY";
    label = needsReview ? REVIEW_LABEL : READY_LABEL;
    for (const c of undecidedChecks) notes.push(`${c.name}: ${c.note ?? "could not be confirmed."}`);
    if (profile.source.review_required || profile.constraints_source?.review_required) {
      notes.push("This printer's requirements still need a human check against their current guide.");
    }
    if (ctx.colorConverted) notes.push("Colours were converted — compare the preview against the original.");
    notes.push(...quality.sourceReasons);
  }
  return { verified: !hardFail, status, label, checks, inspection: out, quality, notes };
}
