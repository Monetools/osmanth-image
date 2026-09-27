import { describe, expect, it } from "vitest";
import { inspectImage } from "@/engine/inspect/inspect";
import { requireProfile, buildCustomProfile } from "@/engine/profiles/registry";
import { cropToRatio, effectivePpiFor, maxPrintSize, resolveTarget } from "@/engine/preflight/geometry";
import { runPreflight, suggestSizes } from "@/engine/preflight/preflight";
import { technicalTier } from "@/engine/preflight/quality";
import { effectivePpi } from "@/engine/units";
import { getGroup } from "@/engine/profiles/registry";
import { makeJpeg, makePng, type JpegOpts } from "./fixtures";

const jpeg = (w: number, h: number, extra: Partial<JpegOpts> = {}) =>
  inspectImage(makeJpeg({ width: w, height: h, quality: 92, ...extra }), "img.jpg").inspection!;

// All 34 real trust records are verified as of 2026-09-27 (see docs/PROFILE_TRUST_INVENTORY.md), so
// tests that need to exercise "pending review" behaviour build a synthetic unverified profile from
// a real one rather than depending on real data staying unverified.
const asUnverified = (id: string) => {
  const p = requireProfile(id);
  return {
    ...p,
    source: {
      ...p.source,
      review_status: "unverified" as const,
      review_required: true,
      verification: { method: "none" as const, verified_at: null, verified_by: null, review_due_at: null, evidence: [] },
    },
  };
};

describe("pixel / PPI math", () => {
  it("3000 pixels / 10 inches = 300 PPI", () => {
    expect(effectivePpi(3000, 10)).toBe(300);
  });
  it("uses the weaker axis", () => {
    expect(effectivePpiFor(2400, 2700, 8, 10)).toBe(270);
  });
  it("converts millimetres exactly (A4 at 300 PPI = 2480 × 3508)", () => {
    const t = resolveTarget(requireProfile("photo.a4"), 2480, 3508);
    expect(Math.round(t.fullW * 300)).toBe(2480);
    expect(Math.round(t.fullH * 300)).toBe(3508);
  });
  it("orients the print to match a landscape image", () => {
    const t = resolveTarget(requireProfile("photo.8x10"), 3000, 2400);
    expect([t.trimW, t.trimH, t.landscape]).toEqual([10, 8, true]);
  });
  it("max recommended print size", () => {
    expect(maxPrintSize(3000, 2400, 300)).toEqual({ w: 10, h: 8 });
  });
});

describe("cropping never stretches", () => {
  it("crops a 4:3 image to 5:4 by trimming width, centred", () => {
    const c = cropToRatio(4000, 3000, 10 / 8);
    expect(c).toMatchObject({ x: 125, y: 0, w: 3750, h: 3000, axis: "x" });
    expect(c.loss).toBeCloseTo(0.0625, 6);
    expect(c.w / c.h).toBeCloseTo(1.25, 6);
  });
  it("offset slides the crop to either edge", () => {
    expect(cropToRatio(4000, 3000, 1.25, -1).x).toBe(0);
    expect(cropToRatio(4000, 3000, 1.25, 1).x).toBe(250);
    expect(cropToRatio(3000, 6000, 0.8, 1).y).toBe(6000 - 3750);
  });
  it("exact ratio → no crop", () => {
    expect(cropToRatio(2400, 3000, 0.8)).toMatchObject({ axis: "none", loss: 0 });
  });
});

describe("hard rule: embedded DPI metadata never changes the verdict", () => {
  it("72 DPI and 300 DPI files with identical pixels get identical results", () => {
    const p = requireProfile("photo.8x10");
    const a = runPreflight({ inspection: jpeg(1200, 1500, { jfifDpi: 72 }), profile: p });
    const b = runPreflight({ inspection: jpeg(1200, 1500, { jfifDpi: 300 }), profile: p });
    expect(a.effectivePpi).toBe(150);
    expect(b.effectivePpi).toBe(150);
    expect(a.status).toBe(b.status);
    expect(a.quality.technical).toBe(b.quality.technical);
    // The metadata note is informational and explicitly says it doesn't change quality.
    const note = b.issues.find((i) => i.id === "metadata.ppi")!;
    expect(note.severity).toBe("info");
    expect(note.detail).toMatch(/doesn't change quality/);
  });
});

describe("status model", () => {
  const p810 = requireProfile("photo.8x10");
  it("READY: exact 8×10 at 300 PPI, clean source", () => {
    const r = runPreflight({ inspection: jpeg(2400, 3000, { jfifDpi: 300 }), profile: p810, source: { sharpness: 80 } });
    expect(r.status).toBe("READY");
    expect(r.summary.headline).toBe("Ready for 8×10 in printing");
    expect(r.summary.issuesFound).toBe(0);
  });
  it("READY_WITH_WARNINGS: acceptable resolution", () => {
    const r = runPreflight({ inspection: jpeg(1600, 2000, { jfifDpi: 200 }), profile: p810 }); // 200 PPI, min 180
    expect(r.quality.technical).toBe("acceptable");
    expect(r.status).toBe("READY_WITH_WARNINGS");
  });
  it("FIXABLE: needs a crop decision", () => {
    const r = runPreflight({ inspection: jpeg(4000, 3000), profile: p810 });
    expect(r.status).toBe("FIXABLE");
    expect(r.summary.needsDecision).toBe(1);
    expect(r.issues.find((i) => i.category === "aspect")?.resolution).toBe("decision");
  });
  it("small trims are automatic but still shown", () => {
    const r = runPreflight({ inspection: jpeg(2400, 3060), profile: p810 }); // 2% loss
    expect(r.issues.find((i) => i.id === "aspect.trim")?.resolution).toBe("auto");
    expect(r.status).toBe("READY");
  });
  it("low resolution without an enhancement provider → REVIEW_RECOMMENDED with a smaller-size suggestion", () => {
    const r = runPreflight({ inspection: jpeg(1200, 1500), profile: p810 }); // 150 PPI < 180
    expect(r.quality.technical).toBe("low");
    expect(r.status).toBe("REVIEW_RECOMMENDED");
    expect(r.issues.find((i) => i.category === "resolution")?.detail).toMatch(/prints well up to about/);
  });
  it("NOT_RECOMMENDED: tiny image for a big poster", () => {
    const r = runPreflight({ inspection: jpeg(400, 600), profile: requireProfile("photo.24x36") }); // 16.7 PPI: needs 6× to reach 100
    expect(r.quality.technical).toBe("unusable");
    expect(r.status).toBe("NOT_RECOMMENDED");
  });
  it("viewing context: the same pixels are fine for a poster but not for a small photo", () => {
    expect(technicalTier(120, requireProfile("photo.24x36"))).toBe("acceptable");
    expect(technicalTier(120, requireProfile("photo.4x6"))).toBe("low");
  });
  it("heavy compression raises REVIEW_RECOMMENDED even with enough pixels", () => {
    const r = runPreflight({ inspection: jpeg(2400, 3000, { quality: 40 }), profile: p810 });
    expect(r.quality.source).toBe("poor");
    expect(r.status).toBe("REVIEW_RECOMMENDED");
  });
  it("platform profiles pending review never report plain READY", () => {
    // All 34 real trust records are verified as of 2026-09-27; build a synthetic unverified one to
    // exercise the pending-review path.
    const r = runPreflight({ inspection: jpeg(3951, 4919), profile: asUnverified("printify.tee.front") });
    expect(r.status).toBe("READY_WITH_WARNINGS");
    expect(r.issues.some((i) => i.id === "profile.review")).toBe(true);
    const verified = runPreflight({ inspection: jpeg(3600, 5400), profile: requireProfile("printful.poster.12x18") });
    expect(verified.issues.some((i) => i.id === "profile.review")).toBe(false);
  });
  it("Printful's 20,000 px upload limit: over it is flagged and fixable, under it is silent", () => {
    const poster = requireProfile("printful.poster.24x36");
    expect(poster.max_dimension_px).toBe(20000);
    const over = runPreflight({ inspection: jpeg(20001, 100), profile: poster });
    expect(over.issues.find((i) => i.id === "dimension.over")?.resolution).toBe("auto");
    const exactly = runPreflight({ inspection: jpeg(20000, 100), profile: poster });
    expect(exactly.issues.find((i) => i.id === "dimension.over")).toBeUndefined();
    // Destinations that publish no such limit never get the warning.
    const none = runPreflight({ inspection: jpeg(20001, 100), profile: p810 });
    expect(none.issues.find((i) => i.id === "dimension.over")).toBeUndefined();
    expect(none.coverage.some((i) => i.id === "dimensions")).toBe(false);
  });
  it("transparency: flattened for paper, missing for apparel", () => {
    const png = inspectImage(makePng({ width: 2400, height: 3000, colorType: 6 }), "a.png").inspection!;
    const paper = runPreflight({ inspection: png, profile: p810, alphaUsed: true });
    expect(paper.issues.find((i) => i.id === "transparency.flatten")?.resolution).toBe("auto");
    const unused = runPreflight({ inspection: png, profile: p810, alphaUsed: false });
    expect(unused.issues.find((i) => i.id === "transparency.flatten")).toBeUndefined();
    const opaque = inspectImage(makePng({ width: 1800, height: 2400 }), "a.png").inspection!;
    const tee = runPreflight({ inspection: opaque, profile: requireProfile("printful.dtg-tee.back") });
    expect(tee.issues.find((i) => i.id === "transparency.missing")).toBeDefined();
  });
  it("CMYK is converted, not blindly required", () => {
    const cmyk = jpeg(2400, 3000, { components: 4, adobeTransform: 0 });
    expect(runPreflight({ inspection: cmyk, profile: p810 }).issues.find((i) => i.id === "color.cmyk")?.resolution).toBe("auto");
    expect(runPreflight({ inspection: cmyk, profile: requireProfile("printify.poster.12x18") }).issues.find((i) => i.id === "color.cmyk")?.resolution).toBe("none");
  });
  it("fit mode keeps the full image and uses its own PPI", () => {
    const r = runPreflight({ inspection: jpeg(4000, 3000), profile: p810, aspectMode: "fit" });
    expect(r.effectivePpi).toBe(375); // 3000 px over 8 in
  });
  it("bleed adds to the physical canvas", () => {
    const p = buildCustomProfile({ width: 210, height: 297, unit: "mm", bleed: { value: 3, unit: "mm" } });
    const r = runPreflight({ inspection: jpeg(2551, 3579), profile: p });
    expect(r.target.fullW).toBeCloseTo(216 / 25.4, 6);
    expect(r.issues.some((i) => i.id === "bleed.info")).toBe(true);
  });
  it("suggests sizes the image can actually print", () => {
    const s = suggestSizes(jpeg(2400, 3000), getGroup("photo_poster")!.profiles);
    expect(s[0].profile.id).toBe("photo.8x10");
    expect(s.every((x) => x.ppi >= x.profile.ppi.minimum - 0.5)).toBe(true);
  });
});
