import photoPoster from "./data/photo_poster.json";
import etsyPrintable from "./data/etsy_printable.json";
import printful from "./data/printful.json";
import printify from "./data/printify.json";
import {
  ALL_SIDES,
  validateGroup,
  validateProfile,
  type BleedSpec,
  type DestinationId,
  type LengthUnit,
  type PrintProfile,
  type ProfileGroup,
} from "./schema";

/**
 * The Profile Registry. Groups are loaded from JSON data and validated once at module load, so a
 * malformed data update fails immediately (and in `npm test`) instead of producing wrong advice.
 */
const GROUPS: ProfileGroup[] = [photoPoster, etsyPrintable, printful, printify] as ProfileGroup[];
for (const g of GROUPS) validateGroup(g);

const BY_ID = new Map<string, PrintProfile>();
for (const g of GROUPS) for (const p of g.profiles) BY_ID.set(p.id, p);

export function listGroups(): readonly ProfileGroup[] {
  return GROUPS;
}

export function getGroup(destination: DestinationId): ProfileGroup | undefined {
  return GROUPS.find((g) => g.destination === destination);
}

export function getProfile(id: string): PrintProfile | undefined {
  return BY_ID.get(id);
}

export function requireProfile(id: string): PrintProfile {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown print profile "${id}"`);
  return p;
}

/**
 * Build a temporary profile for a user-entered custom size. The same builder is the intended
 * target for a future "paste your printer's requirements" parser (see PRINTREADY_ARCHITECTURE.md §Custom specs):
 * a parser only needs to produce these options, never touch image code.
 */
export interface CustomProfileOptions {
  width: number;
  height: number;
  unit: LengthUnit;
  preferredPpi?: number;
  minimumPpi?: number;
  outputFormat?: "jpeg" | "png";
  maxFileSizeBytes?: number | null;
  /** A plain value bleeds on all four sides; pass `sides` for asymmetric bleed (e.g. book interiors). */
  bleed?: { value: number; unit: LengthUnit; sides?: BleedSpec["sides"] } | null;
  safeArea?: { value: number; unit: LengthUnit } | null;
  label?: string;
  sourceNote?: string;
}

export function buildCustomProfile(o: CustomProfileOptions): PrintProfile {
  const w = Math.min(o.width, o.height);
  const h = Math.max(o.width, o.height);
  const longIn = o.unit === "mm" ? h / 25.4 : h;
  // Viewing distance grows with print size; mirror the policy used by the standard profiles.
  const ctx = longIn <= 7 ? "handheld" : longIn <= 12 ? "tabletop" : longIn <= 20 ? "wall" : "large_wall";
  const defaultMin = { handheld: 200, tabletop: 180, wall: 150, large_wall: 100 }[ctx];
  const preferred = o.preferredPpi ?? (longIn > 30 ? 150 : longIn > 20 ? 200 : 300);
  const minimum = Math.min(o.minimumPpi ?? defaultMin, preferred);
  const fmt = o.outputFormat ?? "jpeg";
  const unitLabel = o.unit === "mm" ? " mm" : " in";
  const profile: PrintProfile = {
    id: "custom.user",
    destination: "custom",
    product: "Custom print",
    variant: o.label ?? `${o.width}×${o.height}${unitLabel}`,
    size: { width: w, height: h, unit: o.unit },
    rotatable: true,
    ppi: { preferred, minimum },
    accepted_formats: ["jpeg", "png", "tiff"],
    output_format: fmt,
    transparency: fmt === "png" ? "allowed" : "flatten_to_white",
    color: { expected: "sRGB", cmyk_accepted: false },
    max_file_size_bytes: o.maxFileSizeBytes ?? null,
    bleed: o.bleed ? { value: o.bleed.value, unit: o.bleed.unit, sides: o.bleed.sides ?? { ...ALL_SIDES } } : null,
    safe_area: o.safeArea ?? null,
    viewing_context: ctx,
    special_rules: [],
    source: {
      source_url: "",
      source_type: "user_supplied",
      last_verified_at: new Date().toISOString().slice(0, 10),
      profile_version: "custom",
      // The user told us this size; there is no external source to go stale.
      review_status: "current",
      review_required: false,
      verification: {
        method: "internal_policy",
        verified_at: new Date().toISOString().slice(0, 10),
        verified_by: "the person using PrintReady",
        review_due_at: null,
        evidence: [],
      },
      notes: o.sourceNote ?? "Size entered by the user; resolution thresholds follow PrintReady policy.",
    },
  };
  validateProfile(profile);
  return profile;
}
