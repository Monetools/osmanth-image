/**
 * Print Profile schema — the structured representation of a print destination's requirements.
 *
 * Profiles are DATA (see ./data/*.json). Image-processing code never hard-codes platform rules;
 * it reads them from a validated PrintProfile. See docs/PRINT_PROFILE_SCHEMA.md.
 */

export type LengthUnit = "in" | "mm";
export type FileFormat = "jpeg" | "png" | "webp" | "tiff" | "pdf" | "svg";
export type OutputFormat = "jpeg" | "png";
export type DestinationId = "photo_poster" | "etsy_printable" | "printful" | "printify" | "custom";
export type ViewingContext = "handheld" | "tabletop" | "wall" | "large_wall" | "apparel";
export type TransparencyRule = "flatten_to_white" | "allowed" | "preferred";
export type SourceType =
  | "official_documentation" // the platform's own help center / spec page
  | "printready_policy" // PrintReady's own quality policy (not a platform claim)
  | "industry_convention" // widely used convention; not a platform requirement
  | "user_supplied"; // e.g. a pasted printer spec (future)

export interface Length {
  value: number;
  unit: LengthUnit;
}

/**
 * Bleed is not always symmetric: a book interior bleeds on the outside, top and bottom but not on
 * the bound edge. `sides` says where the profile actually requires it; an omitted side means the
 * page is not trimmed there, so no bleed is added and nothing is reported about it.
 */
export interface BleedSpec {
  value: number;
  unit: LengthUnit;
  sides: { top: boolean; bottom: boolean; inside: boolean; outside: boolean };
}

export const ALL_SIDES = { top: true, bottom: true, inside: true, outside: true } as const;

/**
 * How much a stated requirement can be trusted right now.
 *  current      — verified by a human, recently enough, and the source page has not changed
 *  needs-review — the watched source page changed since a human last verified it
 *  stale        — nobody has re-verified it within the maximum age for its source type
 *  unverified   — never confirmed against an authoritative source (e.g. the page blocks automated
 *                 reading and no human has checked it yet)
 */
export type ReviewStatus = "current" | "needs-review" | "stale" | "unverified";

export interface ProfileSource {
  source_url: string;
  source_type: SourceType;
  /** Verbatim sentence from the source that this rule is based on. Only fill it from the real page. */
  source_quote?: string;
  /** ISO date (YYYY-MM-DD) a human last verified the rule against the source. */
  last_verified_at: string;
  /** ISO date the automated source watch last fetched the page (null = never). */
  last_checked?: string | null;
  /** ISO date the watch last saw the page text change (null = never seen changing). */
  last_changed?: string | null;
  /** Stored trust state. Automation may only downgrade this at read time, never edit the file. */
  review_status: ReviewStatus;
  /** Semver-ish string, bumped whenever the rule content changes. */
  profile_version: string;
  /** Mirror of `review_status !== "current"`, kept explicit in the data and enforced by the validator. */
  review_required: boolean;
  notes?: string;
}

export interface PrintProfile {
  id: string;
  destination: DestinationId;
  /** e.g. "Photo print", "Enhanced Matte Paper Poster" */
  product: string;
  /** e.g. "8×10 in" */
  variant: string;
  /** Finished (trimmed) physical size, in portrait orientation (width <= height). */
  size: { width: number; height: number; unit: LengthUnit };
  /** If true, the size may be rotated to match a landscape image. */
  rotatable: boolean;
  ppi: {
    /** PPI at which output files are prepared when the source allows it. */
    preferred: number;
    /** Below this effective PPI the print is expected to look soft at normal viewing distance. */
    minimum: number;
  };
  accepted_formats: FileFormat[];
  output_format: OutputFormat;
  transparency: TransparencyRule;
  color: {
    /** Working space the destination expects for uploaded files. */
    expected: "sRGB";
    cmyk_accepted: boolean;
  };
  /**
   * Destination upload limit per file, in bytes — the CONSERVATIVE reading of the published limit.
   * null = no known limit.
   */
  max_file_size_bytes: number | null;
  /**
   * The permissive reading of the same published limit, when the platform writes e.g. "20MB"
   * without saying whether that is 20,000,000 or 20 × 1024². A file between the two cannot be
   * judged either way and is reported as "could not verify" rather than guessed.
   */
  max_file_size_bytes_upper?: number | null;
  /** Bleed required beyond the finished size, per side. null = no bleed. */
  bleed: BleedSpec | null;
  /** Inset from the trim edge that important content should stay within. null = none. */
  safe_area: Length | null;
  /**
   * How much more resolution 1-bit line art needs than a photograph on this product (1 = the
   * profile makes no distinction, which is the default and produces no extra warnings).
   */
  line_art_ppi_multiplier?: number;
  viewing_context: ViewingContext;
  special_rules: string[];
  /**
   * For ratio-based deliverables (e.g. Etsy printables): every nominal size one file must serve.
   * `size` is the largest member; all members share its aspect ratio.
   */
  ratio_family?: { label: string; sizes: { width: number; height: number; unit: LengthUnit; label: string }[] };
  /** Where the print-quality rules (PPI, viewing context) come from. */
  source: ProfileSource;
  /**
   * Where the *delivery* constraints come from (file size, accepted formats) when they have a
   * different origin from the quality rules — e.g. an Etsy printable's PPI target is our policy
   * while its 20MB limit is Etsy's. Absent = `source` covers everything.
   */
  constraints_source?: ProfileSource;
}

export interface ProfileGroup {
  destination: DestinationId;
  label: string;
  /** Constraints of a marketplace that apply to the delivered files, separate from image quality. */
  marketplace_constraints?: MarketplaceConstraints;
  profiles: PrintProfile[];
}

export interface MarketplaceConstraints {
  max_files_per_listing: number;
  max_file_size_bytes: number;
  filename_max_length: number;
  /** Regex source for allowed filename characters. */
  filename_allowed: string;
  source: ProfileSource;
}

/* ------------------------------------------------------------------------------------------ */
/* Validation — hand-written so that bad profile data fails loudly at load / test time.        */
/* ------------------------------------------------------------------------------------------ */

export class ProfileValidationError extends Error {}

const FORMATS: FileFormat[] = ["jpeg", "png", "webp", "tiff", "pdf", "svg"];
const DESTINATIONS: DestinationId[] = ["photo_poster", "etsy_printable", "printful", "printify", "custom"];
const VIEWING: ViewingContext[] = ["handheld", "tabletop", "wall", "large_wall", "apparel"];
const SOURCE_TYPES: SourceType[] = ["official_documentation", "printready_policy", "industry_convention", "user_supplied"];
const REVIEW_STATUSES: ReviewStatus[] = ["current", "needs-review", "stale", "unverified"];

function fail(id: string, msg: string): never {
  throw new ProfileValidationError(`Profile "${id}": ${msg}`);
}

export function validateSource(id: string, s: ProfileSource): void {
  if (!s) fail(id, "missing source");
  if (s.source_type !== "user_supplied" && !/^https:\/\//.test(s.source_url)) fail(id, "source_url must be https");
  if (!SOURCE_TYPES.includes(s.source_type)) fail(id, `bad source_type ${s.source_type}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.last_verified_at)) fail(id, "last_verified_at must be YYYY-MM-DD");
  for (const k of ["last_checked", "last_changed"] as const) {
    const v = s[k];
    if (v != null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(id, `${k} must be YYYY-MM-DD or null`);
  }
  if (!s.profile_version) fail(id, "missing profile_version");
  if (!REVIEW_STATUSES.includes(s.review_status)) fail(id, `bad review_status ${s.review_status}`);
  if (typeof s.review_required !== "boolean") fail(id, "review_required must be boolean");
  if (s.review_required !== (s.review_status !== "current")) {
    fail(id, `review_required (${s.review_required}) disagrees with review_status (${s.review_status})`);
  }
}

export function validateProfile(p: PrintProfile): void {
  const id = p?.id ?? "(no id)";
  if (!/^[a-z0-9_.-]+$/.test(id)) fail(id, "id must be lowercase [a-z0-9_.-]");
  if (!DESTINATIONS.includes(p.destination)) fail(id, `bad destination ${p.destination}`);
  if (!p.product || !p.variant) fail(id, "product and variant required");
  const { width, height, unit } = p.size ?? ({} as PrintProfile["size"]);
  if (!(width > 0 && height > 0)) fail(id, "size must be positive");
  if (width > height) fail(id, "size must be stored portrait (width <= height)");
  if (unit !== "in" && unit !== "mm") fail(id, "size.unit must be in|mm");
  if (!(p.ppi?.preferred > 0 && p.ppi?.minimum > 0)) fail(id, "ppi.preferred and ppi.minimum required");
  if (p.ppi.minimum > p.ppi.preferred) fail(id, "ppi.minimum must be <= ppi.preferred");
  if (!p.accepted_formats?.length || p.accepted_formats.some((f) => !FORMATS.includes(f))) fail(id, "bad accepted_formats");
  if (!p.accepted_formats.includes(p.output_format)) fail(id, "output_format must be an accepted format");
  if (!["flatten_to_white", "allowed", "preferred"].includes(p.transparency)) fail(id, "bad transparency");
  if (p.transparency !== "flatten_to_white" && p.output_format === "jpeg") fail(id, "transparency needs png output");
  if (p.max_file_size_bytes !== null && !(p.max_file_size_bytes > 0)) fail(id, "max_file_size_bytes must be > 0 or null");
  if (p.max_file_size_bytes_upper != null) {
    if (p.max_file_size_bytes === null) fail(id, "max_file_size_bytes_upper needs a lower bound");
    if (p.max_file_size_bytes_upper < p.max_file_size_bytes) fail(id, "max_file_size_bytes_upper must be >= max_file_size_bytes");
  }
  if (p.safe_area !== null && !(p.safe_area.value >= 0 && (p.safe_area.unit === "in" || p.safe_area.unit === "mm"))) fail(id, "bad safe_area");
  if (p.bleed !== null) {
    const b = p.bleed;
    if (!(b.value >= 0 && (b.unit === "in" || b.unit === "mm"))) fail(id, "bad bleed");
    if (!b.sides || typeof b.sides.top !== "boolean" || typeof b.sides.bottom !== "boolean" || typeof b.sides.inside !== "boolean" || typeof b.sides.outside !== "boolean") {
      fail(id, "bleed.sides must list all four sides");
    }
    if (b.value > 0 && !(b.sides.top || b.sides.bottom || b.sides.inside || b.sides.outside)) fail(id, "bleed has no sides");
  }
  if (p.line_art_ppi_multiplier != null && !(p.line_art_ppi_multiplier >= 1 && p.line_art_ppi_multiplier <= 4)) {
    fail(id, "line_art_ppi_multiplier must be between 1 and 4");
  }
  if (!VIEWING.includes(p.viewing_context)) fail(id, "bad viewing_context");
  if (!Array.isArray(p.special_rules)) fail(id, "special_rules must be an array");
  if (p.ratio_family) {
    const r = p.size.width / p.size.height;
    let largest = 0;
    const toIn = (v: number, u: LengthUnit) => (u === "mm" ? v / 25.4 : v);
    for (const s of p.ratio_family.sizes) {
      if (!(s.width > 0 && s.height >= s.width)) fail(id, `ratio_family size ${s.label} must be portrait`);
      if (Math.abs(s.width / s.height - r) > 0.01) fail(id, `ratio_family size ${s.label} does not match profile ratio`);
      largest = Math.max(largest, toIn(s.height, s.unit));
    }
    if (Math.abs(largest - toIn(p.size.height, p.size.unit)) > 0.01) fail(id, "size must equal the largest ratio_family member");
  }
  validateSource(id, p.source);
  if (p.constraints_source) validateSource(`${id} (constraints)`, p.constraints_source);
}

export function validateGroup(g: ProfileGroup): void {
  if (!DESTINATIONS.includes(g.destination)) throw new ProfileValidationError(`Group: bad destination ${g.destination}`);
  const ids = new Set<string>();
  for (const p of g.profiles) {
    validateProfile(p);
    if (p.destination !== g.destination) fail(p.id, `destination does not match group ${g.destination}`);
    if (ids.has(p.id)) fail(p.id, "duplicate id");
    ids.add(p.id);
  }
  if (g.marketplace_constraints) validateSource(`${g.destination}.marketplace`, g.marketplace_constraints.source);
}
