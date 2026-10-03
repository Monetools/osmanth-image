import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GuideError, parseGuide, type Guide } from "./frontmatter";

/**
 * Reads content/guides/*.md at build time. Used only by server components and tests -- the pages are
 * prerendered, so none of this ships to the browser.
 */
const DIR = join(process.cwd(), "content", "guides");

let cache: Guide[] | null = null;

export function allGuides(): Guide[] {
  if (cache) return cache;
  const guides = readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseGuide(readFileSync(join(DIR, f), "utf8"), f));
  const seen = new Set<string>();
  for (const g of guides) {
    if (seen.has(g.slug)) throw new GuideError(`two guides use the slug "${g.slug}"`);
    seen.add(g.slug);
  }
  // Newest first; the title breaks ties so the order never depends on the file system.
  cache = guides.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  return cache;
}

export function getGuide(slug: string): Guide | undefined {
  return allGuides().find((g) => g.slug === slug);
}

/** Guides whose one tool button points at this tool page (shown at the bottom of that page). */
export function guidesForTool(path: string): Guide[] {
  const want = path.replace(/^\/+|\/+$/g, "");
  return allGuides().filter((g) => g.toolCta.replace(/^\/+|\/+$/g, "") === want || g.relatedTools.includes(want));
}

export function relatedGuides(slug: string, limit = 3): Guide[] {
  return allGuides().filter((g) => g.slug !== slug).slice(0, limit);
}
