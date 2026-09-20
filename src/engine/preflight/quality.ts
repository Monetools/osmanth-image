import type { PrintProfile, ViewingContext } from "../profiles/schema";

/**
 * Explainable Print Quality model (spec §15). Four independent factors — never one "300 PPI = perfect" number:
 *   1. technical resolution  (objective: pixels ÷ inches)
 *   2. source quality        (compression, softness — measured where we can, "unknown" where we can't)
 *   3. enhancement confidence (how far pixels were synthesised by AI, if at all)
 *   4. viewing context       (handheld vs. wall vs. large wall)
 */
export type TechnicalTier = "excellent" | "good" | "acceptable" | "low" | "very_low" | "unusable";
export type SourceTier = "good" | "fair" | "poor" | "unknown";

export interface SourceSignals {
  /** libjpeg-equivalent quality estimate from quantisation tables. */
  jpegQuality: number | null;
  /**
   * Normalised sharpness (variance of the Laplacian on a downsampled luminance copy), measured in
   * the browser. null = not measured.
   */
  sharpness: number | null;
  /** Source was produced by CMYK→RGB conversion in the browser. */
  cmykConverted?: boolean;
}

export interface QualityAssessment {
  effectivePpi: number;
  technical: TechnicalTier;
  /** Scale factor needed to reach the profile's minimum PPI (1 = already enough). */
  scaleToMinimum: number;
  /** Scale factor needed to reach the profile's preferred PPI. */
  scaleToPreferred: number;
  source: SourceTier;
  sourceReasons: string[];
  enhancement: { applied: boolean; scale: number; confidence: "none" | "high" | "medium" | "low" };
  viewing: ViewingContext;
  /** Plain-language one-liner. */
  headline: string;
  /** Plain-language reasons, in order of importance. */
  explanation: string[];
}

/** Sharpness below this (on our normalised scale) reads as visibly soft at print size. */
export const SHARPNESS_SOFT = 40;
export const SHARPNESS_VERY_SOFT = 15;

export interface PpiThresholds {
  preferred: number;
  minimum: number;
}

/** Accepts a profile or explicit thresholds (a profile may raise them for line art). */
export function technicalTier(ppi: number, source: PrintProfile | PpiThresholds): TechnicalTier {
  const { preferred, minimum } = "ppi" in source ? source.ppi : source;
  if (ppi >= preferred - 0.5) return "excellent";
  if (ppi >= (preferred + minimum) / 2) return "good";
  if (ppi >= minimum - 0.5) return "acceptable";
  const scale = minimum / ppi;
  if (scale <= 2) return "low";
  if (scale <= 4) return "very_low";
  return "unusable";
}

export function assessSource(s: SourceSignals): { tier: SourceTier; reasons: string[] } {
  const reasons: string[] = [];
  let tier: SourceTier = "unknown";
  const worse = (t: SourceTier) => {
    const order: SourceTier[] = ["unknown", "good", "fair", "poor"];
    if (order.indexOf(t) > order.indexOf(tier)) tier = t;
  };
  if (s.jpegQuality !== null) {
    if (s.jpegQuality < 60) {
      worse("poor");
      reasons.push("The photo has been heavily compressed, so blocky artefacts may show in print.");
    } else if (s.jpegQuality < 80) {
      worse("fair");
      reasons.push("The photo has been compressed; fine textures may look slightly smudged up close.");
    } else worse("good");
  }
  if (s.sharpness !== null) {
    if (s.sharpness < SHARPNESS_VERY_SOFT) {
      worse("poor");
      reasons.push("The image looks blurry overall. More pixels won't make it sharper.");
    } else if (s.sharpness < SHARPNESS_SOFT) {
      worse("fair");
      reasons.push("The image looks a little soft.");
    } else worse("good");
  }
  if (s.cmykConverted) {
    worse("fair");
    reasons.push("Colours were converted from print (CMYK) colours; check them before ordering.");
  }
  return { tier, reasons };
}

const VIEWING_TEXT: Record<ViewingContext, string> = {
  handheld: "Small prints are looked at up close, so they need the most detail per inch.",
  tabletop: "Desk and album prints are seen from arm's length.",
  wall: "Wall prints are usually seen from a metre or more away, so slightly lower detail is fine.",
  large_wall: "Large posters are viewed from across a room, so they need fewer pixels per inch than small photos.",
  apparel: "Fabric printing can't show very fine detail, so apparel files need less resolution than photo paper.",
};

export function assessQuality(
  profile: PrintProfile,
  ppi: number,
  source: SourceSignals,
  enhancementScale = 1,
  thresholds: PpiThresholds = profile.ppi,
): QualityAssessment {
  const technical = technicalTier(ppi, thresholds);
  const src = assessSource(source);
  const applied = enhancementScale > 1.001;
  const confidence = !applied ? "none" : enhancementScale <= 2 ? "high" : enhancementScale <= 3 ? "medium" : "low";
  const explanation: string[] = [];
  const headline = {
    excellent: "Plenty of detail for this size.",
    good: "Enough detail for this size.",
    acceptable: "Enough detail at normal viewing distance, but it won't be tack-sharp up close.",
    low: "Not quite enough detail for this size — it may look soft or pixelated.",
    very_low: "Far too little detail for this size.",
    unusable: "This image is much too small for this size.",
  }[technical];
  explanation.push(VIEWING_TEXT[profile.viewing_context]);
  explanation.push(...src.reasons);
  if (applied) {
    explanation.push(
      confidence === "high"
        ? "Some detail was generated by AI enlargement. It usually looks natural at this amount, but it is not detail from the original photo."
        : "A lot of detail was generated by AI enlargement. It can look artificial — check faces, text and fine textures.",
    );
  }
  return {
    effectivePpi: ppi,
    technical,
    scaleToMinimum: Math.max(1, thresholds.minimum / ppi),
    scaleToPreferred: Math.max(1, thresholds.preferred / ppi),
    source: src.tier,
    sourceReasons: src.reasons,
    enhancement: { applied, scale: enhancementScale, confidence },
    viewing: profile.viewing_context,
    headline,
    explanation,
  };
}
