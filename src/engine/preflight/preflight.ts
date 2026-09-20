import type { ImageInspection } from "../inspect/types";
import type { PrintProfile } from "../profiles/schema";
import { describeLimit, describeRatio, formatBytes, formatInches, toInches } from "../units";
import { ASPECT, cropToRatio, effectivePpiFor, maxPrintSize, resolveTarget, type CropRect, type Target } from "./geometry";
import { assessQuality, type QualityAssessment, type SourceSignals } from "./quality";
import { freshnessMessage, hostOf, profileFreshness } from "../profiles/freshness";
import { isMislabelledSrgb } from "../inspect/icc";
import { type CoverageItem } from "./coverage";
import type { ReviewStatus } from "../profiles/schema";

export type PrintStatus =
  | "READY"
  | "READY_WITH_WARNINGS"
  | "FIXABLE"
  | "REVIEW_RECOMMENDED"
  | "NOT_RECOMMENDED"
  | "UNVERIFIED";

export type IssueCategory =
  | "resolution"
  | "aspect"
  | "format"
  | "file_size"
  | "transparency"
  | "color"
  | "orientation"
  | "metadata"
  | "bleed"
  | "source_quality"
  | "integrity"
  | "profile";

/**
 * How an issue gets resolved:
 *  auto     — PrintReady fixes it locally, no decision needed
 *  decision — the user must choose (e.g. how to crop)
 *  ai       — only AI enhancement (paid, gated) can address it
 *  none     — informational / nothing to fix
 */
export type Resolution = "auto" | "decision" | "ai" | "none";

export interface Issue {
  id: string;
  category: IssueCategory;
  severity: "info" | "warning" | "problem" | "blocker";
  resolution: Resolution;
  /** Plain language — no DPI/ICC jargon. */
  title: string;
  detail: string;
}

export interface PreflightInput {
  inspection: ImageInspection;
  profile: PrintProfile;
  /** From a browser pixel scan: does any pixel actually use transparency? null = not measured. */
  alphaUsed?: boolean | null;
  source?: Partial<SourceSignals>;
  /** User's crop placement, -1..1 along the trimmed axis. */
  cropOffset?: number;
  /** "crop" fills the print (trims edges); "fit" keeps the whole image and adds white borders. */
  aspectMode?: "crop" | "fit";
  /** Whether an AI enhancement provider is currently enabled and entitled for this user. */
  enhancementAvailable?: boolean;
  /** Clock override, so freshness and staleness are testable. */
  now?: Date;
}

export interface PreflightResult {
  status: PrintStatus;
  profileId: string;
  target: Target;
  crop: CropRect;
  aspectMode: "crop" | "fit";
  /** Effective PPI of the chosen layout. */
  effectivePpi: number;
  quality: QualityAssessment;
  issues: Issue[];
  /** What was inspected, what did not apply, and what could not be confirmed. */
  coverage: CoverageItem[];
  /** Trust state of the requirements this result is based on. */
  trust: { status: ReviewStatus; message: string };
  /** PPI thresholds actually used (a profile may raise them for line art). */
  thresholds: { preferred: number; minimum: number; lineArtApplied: boolean };
  summary: {
    headline: string;
    issuesFound: number;
    autoFixable: number;
    needsDecision: number;
    needsEnhancement: number;
  };
  maxRecommendedSize: { atPreferred: { w: number; h: number }; atMinimum: { w: number; h: number } };
  advanced: Record<string, string>;
}

const STATUS_RANK: PrintStatus[] = ["READY", "READY_WITH_WARNINGS", "FIXABLE", "REVIEW_RECOMMENDED", "NOT_RECOMMENDED", "UNVERIFIED"];

function worst(a: PrintStatus, b: PrintStatus): PrintStatus {
  return STATUS_RANK.indexOf(a) >= STATUS_RANK.indexOf(b) ? a : b;
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const { inspection: img, profile } = input;
  const aspectMode = input.aspectMode ?? "crop";
  const target = resolveTarget(profile, img.width, img.height);
  const ratio = target.fullW / target.fullH;
  const crop = cropToRatio(img.width, img.height, ratio, input.cropOffset ?? 0);
  const issues: Issue[] = [];

  // Effective PPI of the layout the user will actually get.
  const ppi =
    aspectMode === "crop" || crop.axis === "none"
      ? effectivePpiFor(crop.w, crop.h, target.fullW, target.fullH)
      : effectivePpiFor(img.width, img.height, target.fullW, target.fullH);

  // Line art (1-bit artwork) needs more pixels per inch than a photograph, but only on products
  // whose profile says so. Everywhere else the multiplier is 1 and nothing changes.
  const lineArtMultiplier = profile.line_art_ppi_multiplier ?? 1;
  const lineArtApplied = img.lineArt && lineArtMultiplier > 1;
  const thresholds = {
    preferred: profile.ppi.preferred * (lineArtApplied ? lineArtMultiplier : 1),
    minimum: profile.ppi.minimum * (lineArtApplied ? lineArtMultiplier : 1),
    lineArtApplied,
  };

  const quality = assessQuality(
    profile,
    ppi,
    {
      jpegQuality: input.source?.jpegQuality ?? img.jpegQuality,
      sharpness: input.source?.sharpness ?? null,
      cmykConverted: img.colorModel === "cmyk" || img.colorModel === "ycck",
    },
    1,
    thresholds,
  );

  /* ---------------- Resolution (§4.1): pixels ÷ inches, never embedded DPI ---------------- */
  const size = profile.variant;
  const atPreferred = maxPrintSize(img.width, img.height, thresholds.preferred);
  const atMinimum = maxPrintSize(img.width, img.height, thresholds.minimum);
  const maxSizeText = `${formatInches(atMinimum.w)} × ${formatInches(atMinimum.h)}`;
  const enh = input.enhancementAvailable === true;
  switch (quality.technical) {
    case "acceptable":
      issues.push({
        id: "resolution.acceptable", category: "resolution", severity: "warning", resolution: "none",
        title: "Good enough for normal viewing",
        detail: `It will look fine at ${size} from a normal distance, but won't be razor-sharp up close.`,
      });
      break;
    case "low":
      issues.push({
        id: "resolution.low", category: "resolution", severity: "problem", resolution: enh ? "ai" : "decision",
        title: "Not enough detail for this size",
        detail: `At ${size} this image may look soft or pixelated. It prints well up to about ${maxSizeText}. ` +
          (enh ? "AI enlargement can add pixels, or you can choose a smaller size." : "Choose a smaller size for the best result."),
      });
      break;
    case "very_low":
      issues.push({
        id: "resolution.very_low", category: "resolution", severity: "problem", resolution: enh ? "ai" : "decision",
        title: "Far too little detail for this size",
        detail: `This image would need to be enlarged about ${quality.scaleToMinimum.toFixed(1)}× to print at ${size}. ` +
          `It prints well up to about ${maxSizeText}.` + (enh ? " AI enlargement at this level may look artificial." : ""),
      });
      break;
    case "unusable":
      issues.push({
        id: "resolution.unusable", category: "resolution", severity: "blocker", resolution: "decision",
        title: "Image is much too small for this size",
        detail: `It would need to be enlarged ${quality.scaleToMinimum.toFixed(1)}×, which no tool can do convincingly. It prints well up to about ${maxSizeText}.`,
      });
      break;
  }
  if (lineArtApplied && quality.technical !== "excellent") {
    issues.push({
      id: "resolution.line_art", category: "resolution", severity: "info", resolution: "none",
      title: "Solid black-and-white artwork needs extra resolution",
      detail:
        "This is 1-bit line art: its hard edges look ragged unless it has more detail than a photo needs. " +
        `For ${profile.product.toLowerCase()} we judge it against ${Math.round(thresholds.minimum)} PPI instead of ${profile.ppi.minimum}.`,
    });
  }
  if (img.embeddedPpi && Math.abs(img.embeddedPpi.x - ppi) > 1) {
    issues.push({
      id: "metadata.ppi", category: "metadata", severity: "info", resolution: "auto",
      title: "Print-size setting will be corrected",
      detail: `The file says ${Math.round(img.embeddedPpi.x)} DPI, but that setting doesn't change quality — only the pixels do. ` +
        `We'll set it to match your print size so it opens at the right size.`,
    });
  }

  /* ---------------- Aspect ratio ---------------- */
  if (crop.loss > ASPECT.matchLoss) {
    const pct = Math.round(crop.loss * 100);
    const edges = crop.axis === "x" ? "left and right" : "top and bottom";
    if (crop.loss <= ASPECT.autoTrimLoss) {
      issues.push({
        id: "aspect.trim", category: "aspect", severity: "info", resolution: "auto",
        title: "A thin strip will be trimmed",
        detail: `About ${Math.max(1, pct)}% of the image (${edges} edges) is trimmed to fit ${size} exactly. Check the preview.`,
      });
    } else {
      issues.push({
        id: "aspect.decision", category: "aspect", severity: "warning", resolution: "decision",
        title: "The shape doesn't match this print size",
        detail: `To fill ${size}, about ${pct}% of the image (${edges} edges) must be cropped. You can move the crop, or keep the whole image with white borders.`,
      });
    }
  }

  /* ---------------- Format / size ---------------- */
  if (!profile.accepted_formats.includes(img.format as never)) {
    issues.push({
      id: "format.convert", category: "format", severity: "warning", resolution: "auto",
      title: `File type will be converted to ${profile.output_format.toUpperCase()}`,
      detail: `This destination doesn't accept ${img.format.toUpperCase()} files. We'll convert it.`,
    });
  }
  const sizeLimit = profile.max_file_size_bytes;
  const sizeLimitUpper = profile.max_file_size_bytes_upper ?? sizeLimit;
  let sizeAmbiguous = false;
  if (sizeLimit !== null && img.fileSizeBytes > sizeLimit) {
    if (sizeLimitUpper !== null && img.fileSizeBytes <= sizeLimitUpper) {
      // The platform wrote "20MB" without saying whether that means 20,000,000 or 20 x 1024 x 1024.
      sizeAmbiguous = true;
      const where = hostOf((profile.constraints_source ?? profile.source).source_url);
      issues.push({
        id: "file_size.ambiguous", category: "file_size", severity: "warning", resolution: "auto",
        title: "File size sits right on the published limit",
        detail:
          `This file is ${formatBytes(img.fileSizeBytes)}, which is between the two possible readings of the limit ` +
          `${where} publishes (${sizeLimit.toLocaleString()} or ${sizeLimitUpper.toLocaleString()} bytes). ` +
          "We can't confirm which one they mean, so we'll keep the prepared file below the stricter figure.",
      });
    } else {
      issues.push({
        id: "file_size.over", category: "file_size", severity: "warning", resolution: "auto",
        title: "File is too big to upload",
        detail: `The limit is ${formatBytes(sizeLimit)}; this file is ${formatBytes(img.fileSizeBytes)}. We'll save it more efficiently.`,
      });
    }
  }

  /* ---------------- Transparency ---------------- */
  const maybeTransparent = img.hasAlphaChannel && input.alphaUsed !== false;
  if (maybeTransparent && profile.transparency === "flatten_to_white") {
    issues.push({
      id: "transparency.flatten", category: "transparency", severity: "warning", resolution: "auto",
      title: "Transparent areas will print white",
      detail: "Paper can't be transparent. We'll fill transparent parts with white — check the preview.",
    });
  } else if (!maybeTransparent && profile.transparency === "preferred") {
    issues.push({
      id: "transparency.missing", category: "transparency", severity: "warning", resolution: "none",
      title: "The background will print as a solid block",
      detail: "On a garment, the whole rectangle (including the background) is printed. Use a version with a transparent background if you want only the artwork.",
    });
  }

  /* ---------------- Colour ---------------- */
  if (img.colorModel === "cmyk" || img.colorModel === "ycck") {
    issues.push({
      id: "color.cmyk", category: "color", severity: "warning", resolution: profile.color.cmyk_accepted ? "none" : "auto",
      title: profile.color.cmyk_accepted ? "Print-shop colours detected" : "Colours will be converted for this printer",
      detail: profile.color.cmyk_accepted
        ? "This file uses print-shop (CMYK) colours, which this destination accepts."
        : "This file uses print-shop (CMYK) colours but this destination expects screen colours. We'll convert them; check the colours in the preview.",
    });
  } else if (isMislabelledSrgb(img.icc)) {
    issues.push({
      id: "color.mislabelled", category: "color", severity: "warning", resolution: "auto",
      title: "The colour profile doesn't match its own name",
      detail:
        `This file carries a colour profile named "${img.icc!.description}", but its actual colour definition is not ` +
        "standard sRGB. We'll convert the colours properly; compare the preview against the original.",
    });
  } else if (img.icc && img.icc.family !== "sRGB" && img.icc.family !== "Gray") {
    issues.push({
      id: "color.convert", category: "color", severity: "info", resolution: "auto",
      title: "Colours will be adjusted to the printer's standard",
      detail: `This image uses a wide colour range (${img.icc.family}). We'll convert it to standard colours; very vivid colours may look slightly less intense.`,
    });
  }

  /* ---------------- Orientation ---------------- */
  if (img.orientation !== 1) {
    issues.push({
      id: "orientation.apply", category: "orientation", severity: "info", resolution: "auto",
      title: "Photo will be rotated upright",
      detail: "Your camera stored this photo sideways with a rotation note. We'll save it the right way up so every printer shows it correctly.",
    });
  }

  /* ---------------- Bleed / safe area ---------------- */
  const bleedEdges = (["top", "right", "bottom", "left"] as const).filter((k) => target.bleed[k] > 0);
  if (bleedEdges.length > 0 || target.safe > 0) {
    const where = bleedEdges.length === 4 ? "every edge" : bleedEdges.length ? `the ${bleedEdges.join(", ")} edge${bleedEdges.length > 1 ? "s" : ""}` : "the trim edge";
    issues.push({
      id: "bleed.info", category: "bleed", severity: "info", resolution: "none",
      title: "Edges will be trimmed after printing",
      detail: `This print is trimmed on ${where}. Keep faces and text at least ${formatInches(target.maxBleed + target.safe)} away from it.`,
    });
  }

  /* ---------------- Source quality ---------------- */
  if (quality.source === "poor" || quality.source === "fair") {
    issues.push({
      id: `source.${quality.source}`, category: "source_quality", severity: quality.source === "poor" ? "problem" : "warning",
      resolution: "none",
      title: quality.source === "poor" ? "The original photo has visible quality problems" : "The original photo isn't perfectly clean",
      detail: quality.sourceReasons.join(" "),
    });
  }

  /* ---------------- File integrity ---------------- */
  if (!img.complete) {
    issues.push({
      id: "integrity.truncated", category: "integrity", severity: "problem", resolution: "none",
      title: "This file looks incomplete",
      detail:
        "The image data stops before the end of the file, so part of the picture may be missing or grey when printed. " +
        "Export or download it again before using it.",
    });
  }

  /* ---------------- Profile trust ---------------- */
  const qualityTrust = profileFreshness(profile.source, undefined, undefined, input.now);
  const trustStatus = profileFreshness(profile.source, profile.constraints_source, undefined, input.now);
  // Report against whichever source is the weaker link, so the message names the right page.
  const weakest = trustStatus !== qualityTrust && profile.constraints_source ? profile.constraints_source : profile.source;
  const trust = { status: trustStatus, message: freshnessMessage(trustStatus, weakest) };
  if (trustStatus !== "current") {
    issues.push({
      id: "profile.review", category: "profile", severity: "warning", resolution: "none",
      title: trustStatus === "needs-review" ? "This printer has changed its requirements page" : "Double-check the printer's current requirements",
      detail: trust.message,
    });
  }

  /* ---------------- Status (§6) ---------------- */
  let status: PrintStatus = "READY";
  for (const i of issues) {
    if (i.severity === "info" && i.resolution !== "decision") continue;
    if (i.severity === "blocker") status = worst(status, "NOT_RECOMMENDED");
    else if (i.resolution === "auto" || i.resolution === "decision" || i.resolution === "ai") status = worst(status, "FIXABLE");
    else status = worst(status, "READY_WITH_WARNINGS");
  }
  if (quality.technical === "very_low" || quality.source === "poor") status = worst(status, "REVIEW_RECOMMENDED");
  if (quality.technical === "low" && !enh) status = worst(status, "REVIEW_RECOMMENDED");
  if (!img.complete) status = worst(status, "REVIEW_RECOMMENDED");

  const counted = issues.filter((i) => i.severity !== "info" || i.resolution === "decision");
  const summary = {
    headline: headlineFor(status, size),
    issuesFound: counted.length,
    autoFixable: counted.filter((i) => i.resolution === "auto").length,
    needsDecision: counted.filter((i) => i.resolution === "decision").length,
    needsEnhancement: counted.filter((i) => i.resolution === "ai").length,
  };

  const advanced: Record<string, string> = {
    "Image size": `${img.width} × ${img.height} px (${((img.width * img.height) / 1e6).toFixed(1)} MP)`,
    "Print size":
      `${formatInches(target.trimW)} × ${formatInches(target.trimH)}` +
      (target.maxBleed ? ` + ${formatInches(target.maxBleed)} bleed on ${bleedEdges.join(", ")}` : ""),
    "Effective resolution":
      `${Math.round(ppi)} PPI (target ${Math.round(thresholds.preferred)}, minimum ${Math.round(thresholds.minimum)}` +
      `${thresholds.lineArtApplied ? ", raised for line art" : ""})`,
    "Embedded DPI setting": img.embeddedPpi ? `${Math.round(img.embeddedPpi.x)} (${img.embeddedPpi.source}) — does not affect quality` : "none",
    "Aspect ratio": `${describeRatio(img.width, img.height)} image → ${describeRatio(target.fullW * 100, target.fullH * 100)} print`,
    "Crop": crop.axis === "none" ? "none" : `${crop.w} × ${crop.h} px kept (${(crop.loss * 100).toFixed(1)}% removed)`,
    "File": `${img.format.toUpperCase()}, ${formatBytes(img.fileSizeBytes)}` + (profile.max_file_size_bytes ? ` (limit ${formatBytes(profile.max_file_size_bytes)})` : ""),
    "Colour": `${img.colorModel.toUpperCase()}${img.icc ? `, profile: ${img.icc.description ?? img.icc.family}` : img.srgbChunk ? ", sRGB" : ", no profile (treated as sRGB)"}`,
    "Transparency": img.hasAlphaChannel ? (input.alphaUsed === false ? "alpha channel present but unused" : "yes") : "no",
    "Compression": img.jpegQuality !== null ? `JPEG quality ≈ ${img.jpegQuality}` : "lossless",
    "Profile source": `${profile.source.source_type}, v${profile.source.profile_version}, verified ${profile.source.last_verified_at} -> ${trustStatus}`,
    "File integrity": img.complete ? "complete" : img.structureProblems.join(" "),
  };

  const coverage = buildCoverage(img, profile, {
    alphaUsed: input.alphaUsed ?? null,
    sizeAmbiguous,
    lineArtApplied,
    lineArtMultiplier,
    trustStatus,
    bleedSides: bleedEdges.length,
    safe: target.safe,
  });

  return {
    status, profileId: profile.id, target, crop, aspectMode, effectivePpi: ppi, quality, issues, coverage,
    trust, thresholds, summary, maxRecommendedSize: { atPreferred, atMinimum }, advanced,
  };
}

export function headlineFor(status: PrintStatus, size: string): string {
  switch (status) {
    case "READY": return `Ready for ${size} printing`;
    case "READY_WITH_WARNINGS": return `Ready for ${size} printing, with notes`;
    case "FIXABLE": return `Can be made ready for ${size}`;
    case "REVIEW_RECOMMENDED": return `Printable at ${size}, but the result may disappoint`;
    case "NOT_RECOMMENDED": return `Not recommended at ${size}`;
    case "UNVERIFIED": return "We couldn't check this image";
  }
}

/** Sizes in the same destination group that this image can print well, best first. */
export function suggestSizes(img: ImageInspection, profiles: readonly PrintProfile[]): { profile: PrintProfile; ppi: number; loss: number }[] {
  return profiles
    .map((p) => {
      const t = resolveTarget(p, img.width, img.height);
      const c = cropToRatio(img.width, img.height, t.fullW / t.fullH);
      return { profile: p, ppi: effectivePpiFor(c.w, c.h, t.fullW, t.fullH), loss: c.loss };
    })
    .filter((s) => s.ppi >= s.profile.ppi.minimum - 0.5)
    .sort((a, b) => a.loss - b.loss || toInches(b.profile.size.height, b.profile.size.unit) - toInches(a.profile.size.height, a.profile.size.unit));
}

/**
 * Coverage list. Anything a destination does not require is "not applicable" and produces no
 * warning — bleed, line art and file-size limits only appear for profiles that actually have them.
 */
function buildCoverage(
  img: ImageInspection,
  profile: PrintProfile,
  ctx: {
    alphaUsed: boolean | null;
    sizeAmbiguous: boolean;
    lineArtApplied: boolean;
    lineArtMultiplier: number;
    trustStatus: ReviewStatus;
    bleedSides: number;
    safe: number;
  },
): CoverageItem[] {
  const items: CoverageItem[] = [
    { id: "resolution", label: "Print resolution", state: "checked", note: "Measured from the real pixels and your print size." },
    { id: "aspect", label: "Shape and cropping", state: "checked", note: "Compared with the print's proportions." },
    { id: "format", label: "File type", state: "checked", note: `Checked against what this destination accepts.` },
  ];

  items.push(
    profile.max_file_size_bytes === null
      ? { id: "file_size", label: "Upload size limit", state: "not_applicable", note: "This destination publishes no file-size limit." }
      : ctx.sizeAmbiguous
        ? { id: "file_size", label: "Upload size limit", state: "could_not_verify", note: "The published limit can be read two ways and this file falls between them." }
        : { id: "file_size", label: "Upload size limit", state: "checked", note: `Limit: ${describeLimit(profile.max_file_size_bytes, profile.max_file_size_bytes_upper)}.` },
  );

  if (!img.hasAlphaChannel) {
    items.push({ id: "transparency", label: "Transparency", state: "checked", note: "This file has no transparency." });
  } else if (ctx.alphaUsed === null) {
    items.push({ id: "transparency", label: "Transparency", state: "could_not_verify", note: "The file can hold transparency, but we could not read the pixels to confirm whether it uses any." });
  } else {
    items.push({ id: "transparency", label: "Transparency", state: "checked", note: ctx.alphaUsed ? "Transparent areas found." : "Transparency channel present but unused." });
  }

  if (img.icc && !img.icc.readable) {
    items.push({ id: "color", label: "Colour space", state: "could_not_verify", note: "A colour profile is embedded but could not be read." });
  } else if (img.structureProblems.some((p) => p.includes("colour profile is incomplete"))) {
    items.push({ id: "color", label: "Colour space", state: "could_not_verify", note: "The embedded colour profile is incomplete." });
  } else if (img.icc) {
    items.push({
      id: "color", label: "Colour space", state: "checked",
      note: img.icc.primariesMatchSrgb === undefined
        ? `Identified from the profile name (${img.icc.family}).`
        : `Identified from the profile's own colour definition (${img.icc.family}).`,
    });
  } else {
    items.push({
      id: "color", label: "Colour space", state: "checked",
      note: img.exifColorSpace === 1 ? "No embedded profile; the camera says sRGB." : "No embedded profile, so we treat it as standard sRGB.",
    });
  }

  items.push(
    ctx.bleedSides > 0 || ctx.safe > 0
      ? { id: "bleed", label: "Bleed and trim", state: "checked", note: `This product is trimmed, so bleed is added on ${ctx.bleedSides} side${ctx.bleedSides === 1 ? "" : "s"}.` }
      : { id: "bleed", label: "Bleed and trim", state: "not_applicable", note: "This destination does not trim the print, so no bleed is needed." },
  );

  items.push(
    ctx.lineArtMultiplier > 1
      ? ctx.lineArtApplied
        ? { id: "line_art", label: "Line-art resolution", state: "checked", note: `1-bit artwork is judged at ${ctx.lineArtMultiplier}× the normal resolution on this product.` }
        : { id: "line_art", label: "Line-art resolution", state: "checked", note: "This file is not 1-bit line art, so the normal resolution target applies." }
      : { id: "line_art", label: "Line-art resolution", state: "not_applicable", note: "This destination makes no distinction between line art and photographs." },
  );

  items.push({
    id: "integrity", label: "File integrity", state: "checked",
    note: img.complete ? "The file is complete." : "The file is truncated.",
  });

  items.push(
    img.jpegQuality !== null
      ? { id: "compression", label: "Compression damage", state: "checked", note: `Estimated from the file's own compression tables (quality ≈ ${img.jpegQuality}).` }
      : { id: "compression", label: "Compression damage", state: "not_applicable", note: "This is a lossless format, so there is no JPEG compression to judge." },
  );

  // Deliberately not inspected. Stated rather than silently omitted.
  items.push({
    id: "focus", label: "Focus, blur and noise", state: "not_checked",
    note: "We do not judge whether the photo itself is sharp: automatic blur detection is unreliable on real photos, so it would produce false alarms. Check focus yourself at 100% zoom.",
  });
  items.push({
    id: "content", label: "What is in the picture", state: "not_checked",
    note: "We never look at the subject, faces or text — only the file's measurable properties.",
  });

  // A policy of ours is not a printer's requirement, and must never be worded as one.
  const ownPolicy = profile.source.source_type === "printready_policy" && !profile.constraints_source;
  items.push(
    ctx.trustStatus === "current"
      ? {
          id: "requirements",
          label: ownPolicy ? "Resolution guideline" : "Printer's requirements",
          state: "checked",
          note: ownPolicy
            ? "These resolution targets are PrintReady's own guideline for this print size, not a specific printer's requirement. Follow your printer's own spec if it differs."
            : `Verified against ${hostOf(profile.source.source_url)} on ${profile.source.last_verified_at}.`,
        }
      : {
          id: "requirements",
          label: "Printer's requirements",
          state: "could_not_verify",
          note: freshnessMessage(ctx.trustStatus, profile.constraints_source ?? profile.source),
        },
  );

  return items;
}
