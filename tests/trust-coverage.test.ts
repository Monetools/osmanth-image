import { describe, expect, it } from "vitest";
import { inspectImage } from "@/engine/inspect/inspect";
import { buildCustomProfile, getGroup, requireProfile } from "@/engine/profiles/registry";
import { effectiveFreshness, profileFreshness, MAX_VERIFICATION_AGE_DAYS, type SourceWatchState } from "@/engine/profiles/freshness";
import type { ProfileSource } from "@/engine/profiles/schema";
import { runPreflight } from "@/engine/preflight/preflight";
import { countCoverage } from "@/engine/preflight/coverage";
import { planFix } from "@/engine/fix/planner";
import { verifyOutput } from "@/engine/verify/verify";
import { setJpegPpi } from "@/engine/fix/metadata";
import { describeLimit, formatBytes } from "@/engine/units";
import { makeJpeg, makePng } from "./fixtures";

const NOW = new Date("2026-09-20T12:00:00Z");
const src = (over: Partial<ProfileSource> = {}): ProfileSource => {
  const base: ProfileSource = {
    source_url: "https://example.com/spec",
    source_type: "official_documentation",
    last_verified_at: "2026-09-01",
    review_status: "current",
    review_required: false,
    profile_version: "1.0.0",
    verification: {
      method: "human_page_read",
      verified_at: "2026-09-01",
      verified_by: "tester",
      review_due_at: null,
      evidence: [{ quote: "Maximum file size is 20MB.", supports: ["max_file_size_bytes"] }],
    },
    ...over,
  };
  // Keep the record consistent unless a test overrides it on purpose.
  if (!over.verification && over.last_verified_at) base.verification.verified_at = over.last_verified_at;
  if (over.review_status === "unverified" && !over.verification) {
    base.verification = { method: "none", verified_at: null, verified_by: null, evidence: [] };
  }
  return base;
};
const watch = (status: SourceWatchState["sources"][number]["status"]): SourceWatchState => ({
  sources: [{ url: "https://example.com/spec", verifiedHash: "a", lastSeenHash: "b", lastChecked: "2026-09-19", lastChanged: "2026-09-19", status }],
});
const empty: SourceWatchState = { sources: [] };

describe("source trust and freshness", () => {
  it("a recently verified rule with an unchanged page is current", () => {
    expect(effectiveFreshness(src(), watch("unchanged"), NOW)).toBe("current");
  });

  it("goes stale after the maximum age for its source type", () => {
    expect(MAX_VERIFICATION_AGE_DAYS.official_documentation).toBe(90);
    expect(effectiveFreshness(src({ last_verified_at: "2026-01-01" }), empty, NOW)).toBe("stale");
    // Our own policy does not expire as fast as a platform's help page.
    expect(effectiveFreshness(src({ source_type: "printready_policy", last_verified_at: "2026-01-01" }), empty, NOW)).toBe("current");
    expect(effectiveFreshness(src({ source_type: "printready_policy", last_verified_at: "2024-01-01" }), empty, NOW)).toBe("stale");
  });

  it("a changed source page downgrades a current rule to needs-review", () => {
    expect(effectiveFreshness(src(), watch("changed-needs-review"), NOW)).toBe("needs-review");
  });

  it("a failed fetch never upgrades or downgrades on its own", () => {
    expect(effectiveFreshness(src(), watch("fetch-failed"), NOW)).toBe("current");
    expect(effectiveFreshness(src({ review_status: "unverified", review_required: true }), watch("fetch-failed"), NOW)).toBe("unverified");
  });

  it("automation can never turn an unverified rule into a current one", () => {
    const unverified = src({ review_status: "unverified", review_required: true });
    for (const st of ["unchanged", "changed-needs-review", "fetch-failed", "never-checked"] as const) {
      expect(effectiveFreshness(unverified, watch(st), NOW)).toBe("unverified");
    }
  });

  it("a profile is only as trustworthy as its weakest source", () => {
    const quality = src({ source_type: "printready_policy" });
    const constraints = src({ review_status: "unverified", review_required: true });
    expect(profileFreshness(quality, undefined, empty, NOW)).toBe("current");
    expect(profileFreshness(quality, constraints, empty, NOW)).toBe("unverified");
  });

  it("the shipped data reflects what we could actually verify", () => {
    // Etsy printables: our PPI policy is ours, but the 20MB limit is Etsy's and is unverified.
    const etsy = requireProfile("etsy.2x3");
    expect(etsy.source.source_type).toBe("printready_policy");
    expect(etsy.constraints_source?.review_status).toBe("unverified");
    for (const d of ["printful", "printify"] as const) {
      for (const p of getGroup(d)!.profiles) expect(p.source.review_status).toBe("unverified");
    }
    for (const p of getGroup("photo_poster")!.profiles) expect(p.source.review_status).toBe("current");
  });

  it("preflight reports the weakest source and never says READY for an unverified one", () => {
    const img = inspectImage(makeJpeg({ width: 4800, height: 7200, quality: 92 }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: img, profile: requireProfile("etsy.2x3"), now: NOW });
    expect(r.trust.status).toBe("unverified");
    expect(r.status).not.toBe("READY");
    expect(r.issues.find((i) => i.id === "profile.review")?.detail).toMatch(/etsy\.com/);
  });
});

describe("ambiguous published limits", () => {
  const etsy = requireProfile("etsy.2x3");

  it("keeps both readings of the limit in the data", () => {
    expect(etsy.max_file_size_bytes).toBe(20_000_000);
    expect(etsy.max_file_size_bytes_upper).toBe(20 * 1024 * 1024);
  });

  it("reports a file between the two readings as unconfirmable rather than guessing", () => {
    const between = new Uint8Array(20_500_000);
    const real = makeJpeg({ width: 4800, height: 7200 });
    between.set(real.subarray(0, Math.min(real.length, between.length)));
    const img = { ...inspectImage(real, "a.jpg").inspection!, fileSizeBytes: 20_500_000 };
    const r = runPreflight({ inspection: img, profile: etsy, now: NOW });
    const issue = r.issues.find((i) => i.id === "file_size.ambiguous");
    expect(issue).toBeDefined();
    expect(issue!.detail).toMatch(/can't confirm which one/);
    expect(r.coverage.find((c) => c.id === "file_size")?.state).toBe("could_not_verify");
  });

  it("a file over both readings is simply too big", () => {
    const img = { ...inspectImage(makeJpeg({ width: 4800, height: 7200 }), "a.jpg").inspection!, fileSizeBytes: 30_000_000 };
    const r = runPreflight({ inspection: img, profile: etsy, now: NOW });
    expect(r.issues.some((i) => i.id === "file_size.over")).toBe(true);
    expect(r.coverage.find((c) => c.id === "file_size")?.state).toBe("checked");
  });
});

describe("per-side bleed", () => {
  const img = inspectImage(makeJpeg({ width: 3000, height: 4500 }), "a.jpg").inspection!;

  it("adds bleed only on the sides the profile trims", () => {
    const book = buildCustomProfile({
      width: 6, height: 9, unit: "in",
      bleed: { value: 0.125, unit: "in", sides: { top: true, bottom: true, inside: false, outside: true } },
    });
    const r = runPreflight({ inspection: img, profile: book, now: NOW });
    expect(r.target.bleed).toEqual({ top: 0.125, right: 0.125, bottom: 0.125, left: 0 });
    expect(r.target.fullW).toBeCloseTo(6.125, 6);
    expect(r.target.fullH).toBeCloseTo(9.25, 6);
    expect(r.issues.find((i) => i.id === "bleed.info")?.detail).toMatch(/top, right, bottom/);
  });

  it("a plain bleed value still means all four sides", () => {
    const flyer = buildCustomProfile({ width: 148, height: 210, unit: "mm", bleed: { value: 3, unit: "mm" } });
    const r = runPreflight({ inspection: img, profile: flyer, now: NOW });
    expect(r.target.fullW).toBeCloseTo(154 / 25.4, 6);
    expect(r.issues.find((i) => i.id === "bleed.info")?.detail).toMatch(/every edge/);
  });

  it("destinations without bleed say nothing about it", () => {
    const r = runPreflight({ inspection: img, profile: requireProfile("photo.8x10"), now: NOW });
    expect(r.target.maxBleed).toBe(0);
    expect(r.issues.some((i) => i.category === "bleed")).toBe(false);
    expect(r.coverage.find((c) => c.id === "bleed")?.state).toBe("not_applicable");
  });
});

describe("line-art resolution rule", () => {
  const lineArt = inspectImage(makePng({ width: 1800, height: 2400, colorType: 0, bitDepth: 1 }), "logo.png").inspection!;
  const photo = inspectImage(makePng({ width: 1800, height: 2400 }), "photo.png").inspection!;

  it("only applies where the profile asks for it", () => {
    const tee = requireProfile("printful.dtg-tee.front"); // 12×16 in, 150 PPI, multiplier 2
    const paper = requireProfile("photo.11x14");
    expect(tee.line_art_ppi_multiplier).toBe(2);
    expect(paper.line_art_ppi_multiplier).toBeUndefined();

    const onTee = runPreflight({ inspection: lineArt, profile: tee, now: NOW });
    expect(onTee.thresholds).toMatchObject({ minimum: 300, lineArtApplied: true });

    const onPaper = runPreflight({ inspection: lineArt, profile: paper, now: NOW });
    expect(onPaper.thresholds.lineArtApplied).toBe(false);
    expect(onPaper.thresholds.minimum).toBe(paper.ppi.minimum);
    expect(onPaper.coverage.find((c) => c.id === "line_art")?.state).toBe("not_applicable");
  });

  it("does not raise the bar for photographs on the same product", () => {
    const tee = requireProfile("printful.dtg-tee.front");
    const r = runPreflight({ inspection: photo, profile: tee, now: NOW });
    expect(r.thresholds.lineArtApplied).toBe(false);
    expect(r.thresholds.minimum).toBe(150);
    expect(r.issues.some((i) => i.id === "resolution.line_art")).toBe(false);
  });

  it("explains itself when it changes the verdict", () => {
    const tee = requireProfile("printful.dtg-tee.front");
    const r = runPreflight({ inspection: lineArt, profile: tee, now: NOW });
    // 1800 px over 12 in = 150 PPI: fine for a photo, too soft for line art at 300.
    expect(Math.round(r.effectivePpi)).toBe(150);
    expect(r.quality.technical).toBe("low");
    expect(r.issues.find((i) => i.id === "resolution.line_art")?.detail).toMatch(/300 PPI instead of 150/);
  });

  it("carries the same thresholds into output verification", () => {
    const tee = requireProfile("printful.dtg-tee.front");
    const pre = runPreflight({ inspection: lineArt, profile: tee, now: NOW });
    const { spec } = planFix(lineArt, tee, pre, { aspectMode: "crop", cropOffset: 0 });
    const out = setJpegPpi(makeJpeg({ width: spec.canvas.w, height: spec.canvas.h }), spec.ppi);
    const v = verifyOutput(out, "o.jpg", tee, spec, {
      outputAlphaUsed: false, source: { jpegQuality: null, sharpness: null }, enhancementScale: 1,
      colorConverted: false, thresholds: pre.thresholds,
    });
    expect(v.checks.find((c) => c.name === "Effective resolution")?.expected).toBe("≥ 300 PPI");
  });
});

describe("coverage: what was checked, what did not apply, what is unknown", () => {
  it("lists every area with a state and a reason", () => {
    const img = inspectImage(makeJpeg({ width: 2400, height: 3000, quality: 92 }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: img, profile: requireProfile("photo.8x10"), now: NOW });
    const ids = r.coverage.map((c) => c.id);
    for (const id of ["resolution", "aspect", "format", "file_size", "transparency", "color", "bleed", "line_art", "integrity", "compression", "focus", "content", "requirements"]) {
      expect(ids).toContain(id);
    }
    for (const c of r.coverage) expect(c.note.length).toBeGreaterThan(0);
    const counts = countCoverage(r.coverage);
    expect(counts.checked).toBeGreaterThan(0);
    expect(counts.not_checked).toBeGreaterThanOrEqual(2); // focus and content are honestly declared
  });

  it("marks transparency unknown when the pixels were not scanned", () => {
    const png = inspectImage(makePng({ width: 2400, height: 3000, colorType: 6 }), "a.png").inspection!;
    const unknown = runPreflight({ inspection: png, profile: requireProfile("photo.8x10"), alphaUsed: null, now: NOW });
    expect(unknown.coverage.find((c) => c.id === "transparency")?.state).toBe("could_not_verify");
    const scanned = runPreflight({ inspection: png, profile: requireProfile("photo.8x10"), alphaUsed: false, now: NOW });
    expect(scanned.coverage.find((c) => c.id === "transparency")?.state).toBe("checked");
  });

  it("says the colour space could not be verified when the profile is damaged", () => {
    const icc = [1, 2, 3, 4];
    const img = inspectImage(makeJpeg({ width: 800, height: 1000, icc, iccChunks: 2, iccDropLastChunk: true }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: img, profile: requireProfile("photo.8x10"), now: NOW });
    expect(r.coverage.find((c) => c.id === "color")?.state).toBe("could_not_verify");
  });
});

describe("truncated files are reported, not silently accepted", () => {
  it("downgrades the status and explains the fix", () => {
    const cut = inspectImage(makeJpeg({ width: 2400, height: 3000, quality: 92, noEoi: true }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: cut, profile: requireProfile("photo.8x10"), now: NOW });
    expect(r.status).toBe("REVIEW_RECOMMENDED");
    expect(r.issues.find((i) => i.id === "integrity.truncated")?.detail).toMatch(/Export or download it again/);
    expect(r.coverage.find((c) => c.id === "integrity")?.note).toMatch(/truncated/);
  });
});

describe("our own guidance is never presented as a printer's requirement", () => {
  it("labels PrintReady policy as a guideline in the coverage list", () => {
    const img = inspectImage(makeJpeg({ width: 2400, height: 3000 }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: img, profile: requireProfile("photo.8x10"), now: NOW });
    const req = r.coverage.find((c) => c.id === "requirements")!;
    expect(req.label).toBe("Resolution guideline");
    expect(req.note).toMatch(/PrintReady's own guideline/);
    expect(req.note).not.toMatch(/printful/i);
  });

  it("still names the real source for a platform profile", () => {
    const img = inspectImage(makeJpeg({ width: 3600, height: 5400 }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: img, profile: requireProfile("printful.poster.12x18"), now: NOW });
    const req = r.coverage.find((c) => c.id === "requirements")!;
    expect(req.state).toBe("could_not_verify");
    expect(req.note).toMatch(/printful\.com/);
  });
});

describe("published limits are shown the way the platform writes them", () => {
  it("names the published MB figure and the stricter byte count", () => {
    const img = inspectImage(makeJpeg({ width: 3600, height: 5400 }), "a.jpg").inspection!;
    const r = runPreflight({ inspection: img, profile: requireProfile("printful.poster.12x18"), now: NOW });
    const note = r.coverage.find((c) => c.id === "file_size")!.note;
    expect(note).toMatch(/200 MB as published/);
    expect(note).toMatch(/200,000,000 bytes/);
    expect(note).not.toMatch(/190\.7/);
  });

  it("falls back to a plain size when the limit is unambiguous", () => {
    expect(describeLimit(5_000_000)).toBe(formatBytes(5_000_000));
  });
});
