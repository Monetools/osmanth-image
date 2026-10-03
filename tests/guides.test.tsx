import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { findNeverWords } from "@/brandLanguage";
import { planEtsyPack } from "@/engine/etsy/pack";
import { INTENTS } from "@/engine/intents";
import { inspectImage } from "@/engine/inspect/inspect";
import { runPreflight } from "@/engine/preflight/preflight";
import { getGroup, requireProfile } from "@/engine/profiles/registry";
import { pixelsFor, toInches } from "@/engine/units";
import { GuideError, parseGuide, type Guide } from "@/guides/frontmatter";
import { allGuides } from "@/guides/guides";
import { linksIn, Markdown, parseBlocks } from "@/guides/markdown";
import { SizeAnswer } from "@/components/SizeAnswer";
import { makeJpeg } from "./fixtures";

const root = join(__dirname, "..");
const files = readdirSync(join(root, "content/guides")).filter((f) => f.endsWith(".md"));
const guides = allGuides();
const bySlug = (slug: string): Guide => guides.find((g) => g.slug === slug)!;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const SITE_PAGES = new Set([
  "/", "/guides/", "/privacy/",
  ...INTENTS.map((i) => `/${i.slug}/`),
  ...guides.map((g) => `/guides/${g.slug}/`),
]);
const TOOL_PAGES = new Set(INTENTS.map((i) => `/${i.slug}/`));

describe("guide files: the quality gate every guide must pass", () => {
  it("there is at least one guide, one file per slug, and the slug is the file name", () => {
    expect(guides.length).toBeGreaterThanOrEqual(2);
    expect(guides.length).toBe(files.length);
    for (const g of guides) expect(files, g.slug).toContain(`${g.slug}.md`);
  });

  for (const f of files) {
    const g = parseGuide(readFileSync(join(root, "content/guides", f), "utf8"), f);

    describe(g.slug, () => {
      it("fits the search-result limits the post-build check enforces", () => {
        expect(g.metaTitle.length + " | Osmanth Image".length, "<title>").toBeLessThanOrEqual(70);
        expect(g.description.length, "description").toBeGreaterThanOrEqual(80);
        expect(g.description.length, "description").toBeLessThanOrEqual(160);
        expect(g.title.endsWith("?") || g.title.includes(":"), "the title should be the question or topic itself").toBe(true);
      });

      it("has enough real text to be worth indexing", () => {
        expect(words(g.body)).toBeGreaterThanOrEqual(600);
      });

      it("points its one tool button at a real tool page, and its related tools exist", () => {
        expect(TOOL_PAGES.has(g.toolCta), g.toolCta).toBe(true);
        for (const t of g.relatedTools) expect(TOOL_PAGES.has(`/${t}/`), t).toBe(true);
      });

      it("names its sources, each with the day a person read it", () => {
        expect(g.sources.length).toBeGreaterThanOrEqual(1);
        for (const s of g.sources) {
          expect(s.url).toMatch(/^https:\/\//);
          expect(s.checked <= g.updated, `${s.url} was read after the guide was last updated`).toBe(true);
          expect(s.checked >= "2026-09-01", `${s.url} has an implausible check date`).toBe(true);
        }
      });

      it("never uses a word the brand bans", () => {
        expect(findNeverWords(`${g.title} ${g.metaTitle} ${g.description} ${g.body}`)).toEqual([]);
      });

      it("never promises an outcome it cannot know", () => {
        const promise = /\b(guarantee[sd]?|perfectly sharp|100% sharp|never blurry|always (?:print|looks?) (?:sharp|perfect))\b/i;
        expect(`${g.title} ${g.description} ${g.body}`).not.toMatch(promise);
      });

      it("links only to pages that exist, and only to sources it names", () => {
        const links = linksIn(g.body);
        const site = links.filter((l) => l.startsWith("/"));
        for (const l of site) expect(SITE_PAGES.has(l), `${l} is not a page on this site`).toBe(true);
        expect(new Set(site).size, "at least two different site links").toBeGreaterThanOrEqual(2);
        // The tool button is the one tool entrance; the text may link to at most one other tool page.
        expect(site.filter((l) => TOOL_PAGES.has(l)).length).toBeLessThanOrEqual(1);
        const sourceUrls = new Set(g.sources.map((s) => s.url));
        for (const l of links.filter((l) => l.startsWith("https://"))) expect(sourceUrls.has(l), `${l} is not one of the sources`).toBe(true);
      });

      it("renders to HTML without error, with one table wrapper per table and no raw HTML", () => {
        const html = renderToStaticMarkup(<Markdown source={g.body} />);
        const tables = parseBlocks(g.body).filter((b) => b.t === "table").length;
        expect((html.match(/class="table-scroll"/g) ?? []).length).toBe(tables);
        expect(html).not.toMatch(/<script|<h1/i);
        expect(g.body).not.toMatch(/<\/?[a-z][^>]*>/i);
      });
    });
  }
});

describe("the Markdown subset", () => {
  it("reads headings, lists, quotes, tables and inline marks", () => {
    const html = renderToStaticMarkup(
      <Markdown source={"## One\n\ntext **bold** and `code` and [home](/)\n\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n| A | B |\n|---|---|\n| 1 | 2 |"} />,
    );
    expect(html).toContain("<h2>One</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="/">home</a>');
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<ol><li>x</li><li>y</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain('<th scope="col">A</th>');
    expect(html).toContain('aria-label="One"');
  });

  it("refuses what the design cannot show, instead of dropping it silently", () => {
    expect(() => parseBlocks("# Another title")).toThrow(GuideError);
    expect(() => parseBlocks("#### too deep")).toThrow(GuideError);
    expect(() => parseBlocks("| A | B |\n|---|---|\n| only one |")).toThrow(GuideError);
    expect(() => renderToStaticMarkup(<Markdown source="[x](javascript:alert(1))" />)).toThrow(GuideError);
    expect(() => renderToStaticMarkup(<Markdown source="[x](http://insecure.example)" />)).toThrow(GuideError);
  });

  it("rejects a guide with missing or malformed metadata", () => {
    expect(() => parseGuide("no metadata")).toThrow(GuideError);
    expect(() => parseGuide("---\ntitle: T\n---\nbody")).toThrow(/description/);
    const ok = "---\ntitle: T\ndescription: D\nslug: s\ndate: 2026-10-03\nupdated: 2026-10-03\ntargetQuery: q\ntoolCta: /can-i-print-this/\n";
    expect(parseGuide(`${ok}---\nbody`).toolCta).toBe("/can-i-print-this/");
    expect(() => parseGuide(`${ok.replace("2026-10-03", "3 Oct")}---\nbody`)).toThrow(/YYYY-MM-DD/);
    expect(() => parseGuide(`${ok.replace("slug: s", "slug: Bad Slug")}---\nbody`)).toThrow(/slug/);
    expect(() => parseGuide(`${ok}sources:\n  - only a label\n---\nbody`)).toThrow(/Label \| https/);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Every number in the articles comes from the product's own calculation. These tests recompute them,
 * so an engine change, or a typo, turns the build red instead of publishing a wrong figure.
 * ---------------------------------------------------------------------------------------------- */
const img = (w: number, h: number) => inspectImage(makeJpeg({ width: w, height: h, quality: 92 }), "art.jpg").inspection!;
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (loss: number) => (loss === 0 ? "0%" : `${(loss * 100).toFixed(1)}%`);

describe("etsy-printable-sizes: the numbers match the product", () => {
  const body = bySlug("etsy-printable-sizes").body;
  const group = getGroup("etsy_printable")!;

  it("the largest size in each group needs the pixels the table says at 300 PPI", () => {
    for (const p of group.profiles) {
      const rf = p.ratio_family!;
      const largest = rf.sizes[rf.sizes.length - 1];
      const w = pixelsFor(toInches(largest.width, largest.unit), 300);
      const h = pixelsFor(toInches(largest.height, largest.unit), 300);
      expect(body, `${rf.label} largest size`).toContain(`${fmt(w)} × ${fmt(h)}`);
    }
  });

  it("the 4,800 × 7,200 px example matches the printable planner", () => {
    const plan = planEtsyPack(img(4800, 7200), group);
    for (const it of plan.items) {
      const cells = it.sizes.map((s) => `${s.label.replace(/ in$/, "")}: ${Math.round(s.effectivePpi)}`).join(" · ");
      expect(body, it.profile.ratio_family!.label).toContain(`| ${it.profile.ratio_family!.label} | ${pct(it.loss)} | ${cells} |`);
      expect(it.sizes.every((s) => s.ok), "the article says every size stays above 150 PPI").toBe(true);
    }
  });

  it("the 3,000 × 4,000 px example matches the printable planner", () => {
    const plan = planEtsyPack(img(3000, 4000), group);
    for (const it of plan.items) {
      const good = it.sizes.filter((s) => s.ok);
      const last = good[good.length - 1];
      const flagged = it.sizes.filter((s) => !s.ok).map((s) => `${s.label.replace(/ in$/, "")} (${Math.round(s.effectivePpi)})`).join(", ") || "none";
      const largest = last.label.includes(" in") ? `${last.label} (${Math.round(last.effectivePpi)} PPI)` : `${last.label} (${Math.round(last.effectivePpi)} PPI)`;
      expect(body, it.profile.ratio_family!.label).toContain(`| ${it.profile.ratio_family!.label} | ${largest} | ${flagged} |`);
    }
  });

  it("the file limits it quotes are the ones the verified Etsy record holds", () => {
    const c = group.marketplace_constraints!;
    expect(c.max_files_per_listing).toBe(5);
    expect(c.max_file_size_bytes).toBe(20_000_000);
    expect(c.filename_max_length).toBe(70);
    expect(body).toContain("You can upload up to five digital files. The maximum size for each file is 20MB.");
    expect(body).toContain("File names are limited to 70 alphanumeric characters, periods, underscores, or hyphens.");
  });
});

describe("poster-size-in-pixels: the numbers match the product", () => {
  const body = bySlug("poster-size-in-pixels").body;
  const mm = (v: number) => v / 25.4;
  const SIZES: [string, number, number][] = [
    ["8×10 in", 8, 10], ["11×14 in", 11, 14], ["12×18 in", 12, 18], ["16×20 in", 16, 20], ["18×24 in", 18, 24], ["24×36 in", 24, 36],
    ["A3 (297 × 420 mm)", mm(297), mm(420)], ["A2 (420 × 594 mm)", mm(420), mm(594)], ["A1 (594 × 841 mm)", mm(594), mm(841)],
  ];

  it("the size table is inches × pixels per inch", () => {
    for (const [label, w, h] of SIZES) {
      const at = (ppi: number) => `${fmt(pixelsFor(w, ppi))} × ${fmt(pixelsFor(h, ppi))}`;
      expect(body, label).toContain(`| ${label} | ${at(300)} | ${at(150)} |`);
    }
  });

  it("the guideline table is the product's own guideline for each size", () => {
    for (const [id, label] of [["photo.8x10", "8×10 in"], ["photo.11x14", "11×14 in"], ["photo.12x18", "12×18 in"], ["photo.18x24", "18×24 in"], ["photo.24x36", "24×36 in"]] as const) {
      const p = requireProfile(id);
      const w = toInches(p.size.width, p.size.unit);
      const h = toInches(p.size.height, p.size.unit);
      const min = `${fmt(pixelsFor(w, p.ppi.minimum))} × ${fmt(pixelsFor(h, p.ppi.minimum))}`;
      expect(body, id).toContain(`| ${label} | ${p.ppi.preferred} | ${p.ppi.minimum} | ${min} |`);
    }
  });

  it("the two-photo example matches the print check", () => {
    const small = img(3000, 4000);
    const large = img(4000, 6000);
    const cell = (inspection: ReturnType<typeof img>, id: string) => {
      const r = runPreflight({ inspection, profile: requireProfile(id) });
      return `${Math.round(r.effectivePpi)} PPI, ${pct(r.crop.loss)} cropped`;
    };
    for (const [id, label] of [["photo.8x10", "8×10 in"], ["photo.11x14", "11×14 in"], ["photo.12x18", "12×18 in"], ["photo.18x24", "18×24 in"], ["photo.24x36", "24×36 in"]] as const) {
      expect(body, id).toContain(`| ${label} | ${cell(small, id)} | ${cell(large, id)} |`);
    }
    // The three sentences the article quotes from the tool are the tool's own words.
    expect(runPreflight({ inspection: small, profile: requireProfile("photo.18x24") }).quality.headline).toBe("Enough detail for this size.");
    expect(runPreflight({ inspection: small, profile: requireProfile("photo.24x36") }).quality.headline).toBe("Enough detail at normal viewing distance, but it won't be tack-sharp up close.");
    expect(runPreflight({ inspection: large, profile: requireProfile("photo.24x36") }).quality.headline).toBe("Plenty of detail for this size.");
  });

  it("what it says about Printful and Printify matches the verified records", () => {
    for (const id of ["printful.poster.12x18", "printful.poster.18x24", "printful.poster.24x36"]) {
      expect(requireProfile(id).ppi.minimum, id).toBe(300);
      expect(requireProfile(id).source.verification.evidence.some((e) => e.quote.includes("at least 300 DPI")), id).toBe(true);
    }
    expect(body).toContain("Submit files in PNG or JPEG format with at least 300 DPI");
    expect(requireProfile("printify.poster.12x18").ppi.preferred).toBe(300);
    // 5400 × 7200 is 38,880,000 pixels: "about 38.9 million".
    expect(5400 * 7200 / 1e6).toBeCloseTo(38.88, 2);
    expect(body).toContain("about 38.9 million");
    for (const [w, h, ppi] of [[3600, 5400, 12], [5400, 7200, 18], [7200, 10800, 24]] as const) {
      expect(w / ppi).toBe(300);
      expect(body).toContain(`${fmt(w)} × ${fmt(h)}`);
    }
  });
});

describe("size pages answer \"how many pixels?\" from the size's own profile", () => {
  it("8×10 and A4 show the pixel counts the tool uses", () => {
    const e = renderToStaticMarkup(<SizeAnswer profileId="photo.8x10" />);
    expect(e).toContain("2,400 × 3,000 px");
    expect(e).toContain("1,440 × 1,800 px");
    expect(e).toContain("Osmanth Image&#x27;s own guideline");
    const a4 = renderToStaticMarkup(<SizeAnswer profileId="photo.a4" />);
    expect(a4).toContain("A4 is 210 × 297 mm");
    expect(a4).toContain("2,480 × 3,508 px");
  });

  it("renders nothing for a profile that does not exist", () => {
    expect(renderToStaticMarkup(<SizeAnswer profileId="nope" />)).toBe("");
  });
});
