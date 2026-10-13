import { describe, expect, it } from "vitest";
import { inspectImage } from "@/engine/inspect/inspect";
import { buildCustomProfile, requireProfile } from "@/engine/profiles/registry";
import { runPreflight } from "@/engine/preflight/preflight";
import { pixelsFor, toInches } from "@/engine/units";
import { parseBlocks } from "@/guides/markdown";
import { allGuides } from "@/guides/guides";
import { makeJpeg } from "./fixtures";

/**
 * Every figure and every quoted sentence from the product in these guides is recomputed here from the
 * engine. If the engine changes or a number is mistyped, the build goes red instead of publishing it.
 */
const bySlug = (slug: string) => allGuides().find((g) => g.slug === slug)!;
const img = (w: number, h: number, dpi?: number) =>
  inspectImage(makeJpeg({ width: w, height: h, quality: 92, ...(dpi !== undefined ? { jfifDpi: dpi } : {}) }), "art.jpg").inspection!;
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (loss: number) => `${+(loss * 100).toFixed(1)}%`;
const run = (id: string, w: number, h: number) => runPreflight({ inspection: img(w, h), profile: requireProfile(id) });

describe("every guide follows the article template", () => {
  const OWN = /(checkbeforesend|checkbeforepublish|checkbeforesubmit|osmanthvideo|osmanthdocs|osmanthimage|osmanthwatch|monetools|luvymia|cubewithin)\.com$/;
  const QUESTION = /^(how|what|why|can|do|does|is|are|should|which|when)\b/i;
  const EVIDENCE = /\b(we (tested|ran|measured|converted|checked|opened|cleaned|found|tried|read|built)|in our (own )?(test|testing|check|run)|our (test|testing|measurement))\b/i;

  for (const g of allGuides()) {
    describe(g.slug, () => {
      const blocks = parseBlocks(g.body);
      const first = blocks.find((b) => b.t === "p");

      it("Q: the heading is a question, or the page opens with one clear topic", () => {
        expect(g.title.endsWith("?") || QUESTION.test(g.title), g.title).toBe(true);
      });

      it("A: the first paragraph is a self-contained direct answer of 15–60 words", () => {
        expect(first?.t).toBe("p");
        const n = (first as { text: string }).text.split(/\s+/).filter(Boolean).length;
        expect(n, "first paragraph words").toBeGreaterThanOrEqual(15);
        expect(n, "first paragraph words").toBeLessThanOrEqual(60);
        expect(blocks[0].t, "the answer comes before any heading").toBe("p");
      });

      it("S: at least two outside sources, on at least two different sites", () => {
        const hosts = new Set(g.sources.map((s) => new URL(s.url).hostname.replace(/^www\./, "")).filter((h) => !OWN.test(h)));
        expect(hosts.size).toBeGreaterThanOrEqual(2);
      });

      it("T: a table or a list the answer can be lifted from", () => {
        expect(blocks.some((b) => b.t === "table" || b.t === "ol" || (b.t === "ul" && b.items.length >= 4))).toBe(true);
      });

      it("F: says what we ran, so the page holds something other sites do not", () => {
        expect(g.body).toMatch(EVIDENCE);
        expect(blocks.some((b) => b.t === "h2" && /what we tested/i.test(b.text)), "a 'What we tested' section").toBe(true);
      });

      it("states its limits", () => {
        expect(blocks.some((b) => b.t === "h2" && /limits/i.test(b.text)), "a 'Limits' section").toBe(true);
      });
    });
  }
});

describe("300-dpi-image-still-blurry: the numbers match the product", () => {
  const body = bySlug("300-dpi-image-still-blurry").body;

  it("two files with the same pixels and different DPI tags get the same verdict", () => {
    const a = runPreflight({ inspection: img(2400, 3000, 72), profile: requireProfile("photo.8x10") });
    const b = runPreflight({ inspection: img(2400, 3000, 300), profile: requireProfile("photo.8x10") });
    expect(img(2400, 3000, 72).embeddedPpi?.x).toBe(72);
    expect(img(2400, 3000, 300).embeddedPpi?.x).toBe(300);
    expect(Math.round(a.effectivePpi)).toBe(300);
    expect(Math.round(b.effectivePpi)).toBe(300);
    expect(a.quality.headline).toBe(b.quality.headline);
    expect(a.quality.headline).toBe("Plenty of detail for this size.");
    expect(a.advanced["Embedded DPI setting"]).toBe("72 (jfif) — does not affect quality");
    expect(body).toContain(`"Embedded DPI setting: 72 (jfif) — does not affect quality"`);
    expect(a.issues.some((i) => i.title === "Print-size setting will be corrected")).toBe(true);
    expect(b.issues.some((i) => i.title === "Print-size setting will be corrected")).toBe(false);
  });

  it("the four-size table is what the check reports for 2,400 × 3,000 px", () => {
    for (const [w, h] of [[8, 10], [12, 15], [16, 20], [20, 25]] as const) {
      const p = buildCustomProfile({ width: w, height: h, unit: "in" });
      const r = runPreflight({ inspection: img(2400, 3000, 300), profile: p });
      expect(body, `${w}x${h}`).toContain(`| ${w}×${h} in | ${Math.round(r.effectivePpi)} | ${p.ppi.preferred} and ${p.ppi.minimum} | ${r.quality.headline} |`);
    }
    expect(2400 / 8).toBe(300);
    expect(2400 / 16).toBe(150);
  });

  it("does not claim to measure blur, because the app does not", () => {
    expect(body).toContain("It does not measure blur");
    expect(body).not.toMatch(/measures a photo as blurry/i);
  });
});

describe("printful-file-requirements: the numbers match the records and the product", () => {
  const body = bySlug("printful-file-requirements-posters-tshirts").body;
  const ROWS: [string, string][] = [
    ["printful.poster.12x18", "Poster 12×18 in"], ["printful.poster.18x24", "Poster 18×24 in"], ["printful.poster.24x36", "Poster 24×36 in"],
    ["printful.dtg-tee.front-xs-m", "T-shirt front, XS–M, 11.5 × 13.8 in"], ["printful.dtg-tee.front-l-up", "T-shirt front, L and up, 15 × 18 in"],
    ["printful.dtg-tee.back", "T-shirt back, all sizes, 12 × 16 in"],
  ];

  it("the pixel table is inches × the DPI Printful states, and those records are verified", () => {
    for (const [id, label] of ROWS) {
      const p = requireProfile(id);
      const w = pixelsFor(toInches(p.size.width, p.size.unit), p.ppi.minimum);
      const h = pixelsFor(toInches(p.size.height, p.size.unit), p.ppi.minimum);
      expect(body, id).toContain(`| ${label} | ${p.ppi.minimum} DPI | ${fmt(w)} × ${fmt(h)} |`);
      expect(p.source.verification.method, id).toBe("human_page_read");
      expect(p.max_file_size_bytes, id).toBe(200_000_000);
      expect(p.max_dimension_px, id).toBe(20000);
    }
    expect(requireProfile("printful.poster.12x18").ppi.minimum).toBe(300);
    expect(requireProfile("printful.dtg-tee.back").ppi.minimum).toBe(150);
  });

  it("the test results it quotes are the check's own words", () => {
    const say = (id: string, w: number, h: number) => { const r = run(id, w, h); return { ppi: Math.round(r.effectivePpi), head: r.summary.headline, q: r.quality.headline }; };
    expect(say("printful.poster.12x18", 3600, 5400)).toMatchObject({ ppi: 300, head: "Ready for 12×18 in printing" });
    for (const [w, h, ppi] of [[2700, 4050, 225], [1800, 2700, 150]] as const) {
      expect(say("printful.poster.12x18", w, h)).toMatchObject({ ppi, head: "Printable at 12×18 in, but the result may disappoint", q: "Not quite enough detail for this size — it may look soft or pixelated." });
    }
    expect(say("printful.poster.24x36", 7200, 10800).head).toBe("Ready for 24×36 in printing");
    expect(say("printful.poster.24x36", 3600, 5400)).toMatchObject({ ppi: 150, head: "Printable at 24×36 in, but the result may disappoint" });
    expect(say("printful.dtg-tee.front-xs-m", 1725, 2070)).toMatchObject({ ppi: 150, head: "Ready for Front print area (XS–M) 11.5×13.8 in printing, with notes" });
    expect(say("printful.dtg-tee.front-xs-m", 1200, 1440)).toMatchObject({ ppi: 104, head: "Printable at Front print area (XS–M) 11.5×13.8 in, but the result may disappoint" });
    expect(run("printful.poster.12x18", 20001, 3000).issues.some((i) => i.title === "Image is too large to upload" && i.resolution === "auto")).toBe(true);
    for (const s of ["Ready for 12×18 in printing.", "Printable at 12×18 in, but the result may disappoint,", "Ready for Front print area (XS–M) 11.5×13.8 in printing, with notes.", "Image is too large to upload"]) expect(body).toContain(s);
  });

  it("quotes Printful's own poster and file-size rules", () => {
    expect(body).toContain("PNG or JPEG at 300 DPI or more, in sRGB");
    expect(body).toContain("up to 200 MB and up to 20,000 × 20,000 px");
    expect(body).toContain("filename..png");
  });
});

describe("printify-file-requirements: the numbers match the records and the product", () => {
  const body = bySlug("printify-file-requirements-posters-tshirts").body;

  it("each editor print area is exactly the size × 300, and the tee's inches follow from it", () => {
    for (const [id, w, h] of [["printify.poster.12x18", 3600, 5400], ["printify.poster.18x24", 5400, 7200], ["printify.poster.24x36", 7200, 10800]] as const) {
      const p = requireProfile(id);
      expect(pixelsFor(p.size.width, 300), id).toBe(w);
      expect(pixelsFor(p.size.height, 300), id).toBe(h);
      expect(body, id).toContain(`${fmt(w)} × ${fmt(h)} px | ${fmt(w)} × ${fmt(h)} |`);
      expect(p.max_file_size_bytes).toBe(100_000_000);
      expect(p.ppi.minimum, "the 150 PPI floor the limits section calls our own reading").toBe(150);
      expect(p.ppi.preferred).toBe(300);
    }
    const tee = requireProfile("printify.tee.front");
    expect([tee.size.width, tee.size.height]).toEqual([13.17, 16.4]);
    expect(Math.round(3951 / 300 * 100) / 100).toBe(13.17);
    expect(Math.round(4919 / 300 * 10) / 10).toBe(16.4);
    expect(body).toContain("3,951 × 4,919 px at 300 DPI");
  });

  it("the test results it quotes are the check's own words", () => {
    const say = (id: string, w: number, h: number) => { const r = run(id, w, h); return { ppi: Math.round(r.effectivePpi), head: r.summary.headline, q: r.quality.headline }; };
    expect(say("printify.poster.18x24", 5400, 7200)).toMatchObject({ ppi: 300, head: "Ready for 18×24 in printing" });
    for (const [w, h, ppi] of [[3600, 4800, 200], [2700, 3600, 150]] as const) {
      expect(say("printify.poster.18x24", w, h)).toMatchObject({ ppi, head: "Ready for 18×24 in printing, with notes", q: "Enough detail at normal viewing distance, but it won't be tack-sharp up close." });
    }
    expect(say("printify.poster.18x24", 1800, 2400)).toMatchObject({ ppi: 100, head: "Printable at 18×24 in, but the result may disappoint" });
    expect(say("printify.poster.12x18", 3600, 5400)).toMatchObject({ ppi: 300, head: "Ready for 12×18 in printing" });
    expect(say("printify.poster.24x36", 7200, 10800)).toMatchObject({ ppi: 300, head: "Ready for 24×36 in printing" });
    expect(say("printify.tee.front", 3951, 4919)).toMatchObject({ ppi: 300, head: "Ready for Front print area (size L) 13.17×16.4 in printing, with notes" });
    for (const s of ["Ready for 18×24 in printing.", "Ready for 18×24 in printing, with notes", "Printable at 18×24 in, but the result may disappoint.", "Ready for Front print area (size L) 13.17×16.4 in printing, with notes"]) expect(body).toContain(s);
  });

  it("quotes Printify's own limits", () => {
    expect(body).toContain("might also be sufficient (depending on the product)");
    expect(body).toContain("120–150 DPI");
    expect(body).toContain("up to 100 MB for JPEG and PNG");
  });
});

describe("why-8x10-print-cuts-off-my-photo: the numbers match the product", () => {
  const body = bySlug("why-8x10-print-cuts-off-my-photo").body;
  const SHAPES: [string, number, number][] = [
    ["4:5", 4000, 5000], ["3:4", 3000, 4000], ["2:3 portrait", 4000, 6000], ["3:2 landscape", 6000, 4000], ["1:1 square", 3000, 3000], ["16:9", 3840, 2160],
  ];

  it("the shape table is what the 8×10 in check reports", () => {
    for (const [shape, w, h] of SHAPES) {
      const r = run("photo.8x10", w, h);
      const edges = r.crop.axis === "none" ? "none" : r.crop.axis === "y" ? "top and bottom" : "left and right";
      expect(body, shape).toContain(`| ${shape} | ${fmt(w)} × ${fmt(h)} px | ${edges} | ${pct(r.crop.loss)} | ${Math.round(r.effectivePpi)} |`);
      expect(Math.round(r.effectivePpi), "resolution stays at 270 or more").toBeGreaterThanOrEqual(270);
    }
  });

  it("the sentences it quotes are the check's own", () => {
    const r = run("photo.8x10", 3000, 4000);
    const detail = r.issues.find((i) => i.category === "aspect")!.detail;
    expect(detail).toBe("To fill 8×10 in, about 6% of the image (top and bottom edges) must be cropped. You can move the crop, or keep the whole image with white borders.");
    expect(body).toContain(detail);
    expect(run("photo.8x10", 4000, 6000).issues.find((i) => i.category === "aspect")!.detail).toContain("about 17% of the image (top and bottom edges)");
    expect(run("photo.8x10", 3840, 2160).issues.find((i) => i.category === "aspect")!.detail).toContain("about 30% of the image (left and right edges)");
  });

  it("the sizes it says fit each shape are the printable groups the tool builds", () => {
    expect(4000 / 5000).toBe(0.8);
    for (const [id, expected] of [["etsy.2x3", ["4×6", "8×12", "12×18"]], ["etsy.3x4", ["6×8", "9×12", "12×16", "18×24"]], ["etsy.4x5", ["4×5", "8×10", "16×20"]]] as const) {
      const labels = requireProfile(id).ratio_family!.sizes.map((s) => s.label.replace(/ in$/, ""));
      for (const e of expected) expect(labels, `${id} ${e}`).toContain(e);
    }
  });
});

describe("how-big-can-i-print-a-phone-photo: the numbers match the product", () => {
  const body = bySlug("how-big-can-i-print-a-phone-photo").body;
  const SIZES: [string, string][] = [
    ["4×6 in", "photo.4x6"], ["5×7 in", "photo.5x7"], ["8×10 in", "photo.8x10"], ["11×14 in", "photo.11x14"], ["12×18 in", "photo.12x18"],
    ["18×24 in", "photo.18x24"], ["24×36 in", "photo.24x36"], ["A4 (210 × 297 mm)", "photo.a4"], ["A3 (297 × 420 mm)", "photo.a3"],
  ];
  const PHOTOS: [number, number][] = [[3264, 2448], [4032, 3024], [8000, 6000]];
  const WORD = { excellent: "plenty", good: "enough", acceptable: "normal distance", low: "not quite" } as const;

  it("the table is the check's pixels per inch and verdict for each photo at each size", () => {
    for (const [label, id] of SIZES) {
      const cells = PHOTOS.map(([w, h]) => {
        const r = run(id, w, h);
        return `${fmt(Math.round(r.effectivePpi))} · ${WORD[r.quality.technical as keyof typeof WORD]}`;
      });
      expect(body, label).toContain(`| ${label} | ${cells.join(" | ")} |`);
    }
  });

  it("the verdict words are the check's own sentences", () => {
    const say = (id: string, w: number, h: number) => run(id, w, h).quality.headline;
    expect(say("photo.8x10", 4032, 3024)).toBe("Plenty of detail for this size.");
    expect(say("photo.18x24", 4032, 3024)).toBe("Enough detail for this size.");
    expect(say("photo.24x36", 4032, 3024)).toBe("Enough detail at normal viewing distance, but it won't be tack-sharp up close.");
    expect(say("photo.24x36", 3264, 2448)).toBe("Not quite enough detail for this size — it may look soft or pixelated.");
    for (const s of ["Plenty of detail for this size.", "Enough detail for this size.", "Enough detail at normal viewing distance, but it won't be tack-sharp up close.", "Not quite enough detail for this size — it may look soft or pixelated."]) expect(body).toContain(s);
  });

  it("the trimming it describes and the megapixel arithmetic are right", () => {
    for (const [id, loss] of [["photo.4x6", 11.1], ["photo.12x18", 11.1], ["photo.24x36", 11.1], ["photo.8x10", 6.3], ["photo.a4", 5.7], ["photo.a3", 5.7], ["photo.5x7", 4.8], ["photo.11x14", 4.5], ["photo.18x24", 0]] as const) {
      expect(+(run(id, 4032, 3024).crop.loss * 100).toFixed(1), id).toBe(loss);
    }
    expect(3264 * 2448 / 1e6).toBeCloseTo(7.99, 2);
    expect(4032 * 3024 / 1e6).toBeCloseTo(12.19, 2);
    expect(8000 * 6000 / 1e6).toBe(48);
    expect(5400 * 7200 / 1e6).toBeCloseTo(38.88, 2);
    expect(Math.round(run("photo.18x24", 8000, 6000).effectivePpi)).toBeGreaterThanOrEqual(300);
    expect(Math.round(run("photo.18x24", 4032, 3024).effectivePpi)).toBeLessThan(300);
  });
});
