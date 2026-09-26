/**
 * Brand Asset Kit, section 7 — words that never appear on a brand surface, and what to say instead.
 * Kept as data so the same list drives the automated scans (tests and the post-build check).
 *
 * Deliberately NOT restricted: "DPI" / "PPI" on their own. People search for "300 DPI image checker",
 * and the kit does not rename the product's SEO entrances. What it bans is the phrase "effective PPI".
 */
export const NEVER_WORDS: { name: string; re: RegExp; instead: string }[] = [
  { name: "effective PPI", re: /\beffective (?:ppi|dpi|resolution)\b/i, instead: "how big this prints well" },
  { name: "upscale / enhance", re: /\b(?:upscal\w*|enhanc\w*)\b/i, instead: "never — this product does not invent pixels" },
  { name: "ICC / colour space", re: /\bICC\b|\bcolou?r[- ]space\b/i, instead: "the colours will shift a little" },
  { name: "preflight", re: /\bpre-?flight\b/i, instead: "the check" },
  { name: "bleed", re: /\bbleed\w*\b/i, instead: "the extra edge the printer trims off" },
  { name: "raster / bitmap", re: /\b(?:raster|bitmap)\b/i, instead: "image" },
];

/**
 * Proper nouns that contain a banned word but are somebody else's product name, not our wording.
 * Printful's poster is really called "Enhanced Matte Paper Poster".
 */
const THIRD_PARTY_NAMES = [/Enhanced Matte Paper Poster/gi];

/** Returns the banned words found in `text` (empty = clean). */
export function findNeverWords(text: string): string[] {
  let t = text;
  for (const name of THIRD_PARTY_NAMES) t = t.replace(name, " ");
  return NEVER_WORDS.filter((w) => w.re.test(t)).map((w) => w.name);
}
