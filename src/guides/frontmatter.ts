/**
 * A guide is one Markdown file with a small block of metadata at the top. Adding a guide means adding
 * a file under content/guides/ -- no code changes.
 *
 * This file has no imports on purpose: scripts/check-out.mjs imports it directly (Node type
 * stripping), and the Next.js pages and tests import it too, so there is exactly one parser.
 *
 * Format:
 *
 *   ---
 *   title: The page heading (the question the page answers)
 *   metaTitle: Optional shorter <title>; the site name is appended
 *   description: One or two sentences for search results (about 160 characters)
 *   slug: url-segment
 *   date: 2026-10-03
 *   updated: 2026-10-03
 *   targetQuery: the search the page is written for
 *   toolCta: /path-of-the-one-tool-page/
 *   ctaText: Optional button label
 *   relatedTools: Optional comma-separated tool-page slugs that should also list this guide
 *   sources:
 *     - Label | https://official.example/page | 2026-10-03
 *   ---
 *   Body in the Markdown subset described in markdown.tsx.
 */

export interface GuideSource {
  label: string;
  url: string;
  /** The day a person last read the source page (YYYY-MM-DD). */
  checked: string;
}

export interface GuideMeta {
  title: string;
  metaTitle: string;
  description: string;
  slug: string;
  date: string;
  updated: string;
  targetQuery: string;
  toolCta: string;
  ctaText: string;
  /** Tool-page slugs (besides the toolCta page) whose "Guides" list should include this guide. */
  relatedTools: string[];
  sources: GuideSource[];
}

export interface Guide extends GuideMeta {
  body: string;
}

export class GuideError extends Error {}

const REQUIRED = ["title", "description", "slug", "date", "updated", "targetQuery", "toolCta"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseGuide(raw: string, file = "guide"): Guide {
  const text = raw.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new GuideError(`${file}: missing the --- metadata block at the top`);

  const fields: Record<string, string> = {};
  const sourceLines: string[] = [];
  let inSources = false;
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    if (inSources && /^\s+-\s+/.test(line)) {
      sourceLines.push(line.replace(/^\s+-\s+/, "").trim());
      continue;
    }
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new GuideError(`${file}: cannot read metadata line "${line}"`);
    inSources = kv[1] === "sources";
    if (!inSources) fields[kv[1]] = kv[2].trim();
  }

  for (const key of REQUIRED) if (!fields[key]) throw new GuideError(`${file}: metadata "${key}" is missing`);
  for (const key of ["date", "updated"] as const) {
    if (!DATE.test(fields[key])) throw new GuideError(`${file}: "${key}" must be YYYY-MM-DD`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.slug)) throw new GuideError(`${file}: slug "${fields.slug}" must be lower-case words joined by hyphens`);
  if (!/^\/[a-z0-9-]*\/?$/.test(fields.toolCta)) throw new GuideError(`${file}: toolCta "${fields.toolCta}" must be a site path such as /can-i-print-this/`);

  const sources = sourceLines.map((l): GuideSource => {
    const parts = l.split("|").map((s) => s.trim());
    if (parts.length !== 3 || !/^https:\/\//.test(parts[1]) || !DATE.test(parts[2])) {
      throw new GuideError(`${file}: source "${l}" must be "Label | https://url | YYYY-MM-DD"`);
    }
    return { label: parts[0], url: parts[1], checked: parts[2] };
  });

  return {
    title: fields.title,
    metaTitle: fields.metaTitle || fields.title,
    description: fields.description,
    slug: fields.slug,
    date: fields.date,
    updated: fields.updated,
    targetQuery: fields.targetQuery,
    toolCta: fields.toolCta.endsWith("/") ? fields.toolCta : `${fields.toolCta}/`,
    ctaText: fields.ctaText || "Check your own image",
    relatedTools: (fields.relatedTools ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    sources,
    body: m[2].trim(),
  };
}
