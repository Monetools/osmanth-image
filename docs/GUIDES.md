# Guides — how to add one

`/guides/` is a set of articles that each answer one search question and end at one tool. An article is a
file; adding one needs no code change.

## Add a guide

1. Create `content/guides/<slug>.md`. The file name must equal the `slug` in its metadata.
2. Put the metadata block at the top and the article below it (format: `src/guides/frontmatter.ts`).
3. Run `npm run verify`. A guide that fails the quality gate fails the build; nothing is published by hand.
4. Push to `master`. Cloudflare builds and deploys from there.

```
---
title: The question or topic, as the page heading
metaTitle: Shorter <title> (the site name is added; keep the whole title under 70 characters)
description: 80–160 characters for search results
slug: lower-case-words-with-hyphens
date: 2026-10-03
updated: 2026-10-03
targetQuery: the search the page is written for
toolCta: /the-one-tool-page/
ctaText: Optional button label
relatedTools: optional, comma-separated tool slugs whose "Guides" box should also list this guide
sources:
  - Label | https://official-page.example/ | 2026-10-03
---
Body. Start at ##: the title is the only h1.
```

Markdown supported: `##` `###` headings, paragraphs, `-` and `1.` lists, `>` quotes, `|` tables, `**bold**`,
`*italic*`, `` `code` `` and links. Anything else is a build error rather than silently dropped.

## What the quality gate checks (`tests/guides.test.tsx`, `scripts/check-out.mjs`)

* Metadata is complete, `<title>` ≤ 70 characters, description 80–160 characters.
* At least 600 words in the source and 500 in the built HTML (so a crawler that never runs JavaScript can read it).
* At least one source, each with the day a person read it; no link to a page that is not on the site or in `sources`.
* One tool button to a real tool page, and at most one other tool link in the text.
* No word on the brand's banned list; no promise such as "guaranteed sharp".
* Canonical, Open Graph, `Article` + `BreadcrumbList` JSON-LD, sitemap entry, footer link, and a link from the
  matching tool page.
* **Every number that comes from the product is recomputed from the product.** The two existing guides do this
  in `tests/guides.test.tsx`; a new guide that shows tool output should get the same kind of test, so a change
  to the engine turns the build red instead of leaving a stale figure published.

## Rules that are not automated

* Printer and marketplace limits come only from the official page, read by a person, with the date on the guide.
  If it cannot be read, the limit is not stated.
* No invented people, quotes, statistics or case studies. Examples are things the tool actually produced.
* Before writing a new page, check the site for a page that already answers the same question. If there is one,
  improve that page instead (the fixed-size tool pages show a "Pixels needed" answer for this reason).
* PDFs are Check Before Submit's, not ours.
