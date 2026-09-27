import { describe, expect, it } from "vitest";
import { inspectImage } from "@/engine/inspect/inspect";
import { requireProfile } from "@/engine/profiles/registry";
import { runPreflight } from "@/engine/preflight/preflight";
import { planFix } from "@/engine/fix/planner";
import { setJpegPpi, setPngPpi } from "@/engine/fix/metadata";
import { verifyOutput, READY_LABEL, REVIEW_LABEL } from "@/engine/verify/verify";
import { makeJpeg, makePng } from "./fixtures";

const p810 = requireProfile("photo.8x10");
const src = (w: number, h: number) => inspectImage(makeJpeg({ width: w, height: h, quality: 92 }), "in.jpg").inspection!;
const ctx = { outputAlphaUsed: false, source: { jpegQuality: 92, sharpness: 80 }, colorConverted: false };

describe("fix planner", () => {
  it("downsizes a large image to exactly 8×10 at 300 PPI", () => {
    const img = src(4800, 6000);
    const pre = runPreflight({ inspection: img, profile: p810 });
    const plan = planFix(img, p810, pre, { aspectMode: "crop", cropOffset: 0 });
    expect(plan.spec.canvas).toEqual({ w: 2400, h: 3000 });
    expect(plan.spec.ppi).toBe(300);
  });
  it("never adds pixels locally: a small image keeps its native crop size", () => {
    const img = src(1200, 1600);
    const pre = runPreflight({ inspection: img, profile: p810 });
    const plan = planFix(img, p810, pre, { aspectMode: "crop", cropOffset: 0 });
    expect(plan.spec.canvas).toEqual({ w: 1200, h: 1500 });
    expect(plan.spec.canvas.w).toBeLessThanOrEqual(plan.spec.source.w);
    expect(plan.spec.ppi).toBe(150);
    expect(plan.steps.find((s) => s.kind === "metadata")?.label).toMatch(/does not change quality/);
  });
  it("fit mode letterboxes on white without stretching", () => {
    const img = src(4000, 3000);
    const pre = runPreflight({ inspection: img, profile: p810, aspectMode: "fit" });
    const plan = planFix(img, p810, pre, { aspectMode: "fit", cropOffset: 0 });
    expect(plan.spec.canvas).toEqual({ w: 3000, h: 2400 });
    expect(plan.spec.draw.w / plan.spec.draw.h).toBeCloseTo(4000 / 3000, 2);
    expect(plan.spec.background).toBe("#ffffff");
  });
});

describe("metadata writers", () => {
  it("sets JPEG density and the inspector reads it back", () => {
    const out = setJpegPpi(makeJpeg({ width: 2400, height: 3000 }), 300);
    expect(inspectImage(out, "o.jpg").inspection!.embeddedPpi).toEqual({ x: 300, y: 300, source: "jfif" });
    const noJfif = setJpegPpi(makeJpeg({ width: 100, height: 100, jfifDpi: null }), 240);
    expect(inspectImage(noJfif, "o.jpg").inspection!.embeddedPpi?.x).toBe(240);
  });
  it("sets PNG pHYs (replacing any existing one)", () => {
    const out = setPngPpi(makePng({ width: 100, height: 100, ppi: 72 }), 300);
    expect(inspectImage(out, "o.png").inspection!.embeddedPpi!.x).toBeCloseTo(300, 0);
    const n = [...out].filter((_, i) => out[i] === 0x70 && out[i + 1] === 0x48 && out[i + 2] === 0x59 && out[i + 3] === 0x73).length;
    expect(n).toBe(1);
  });
});

describe("verification inspects the actual output", () => {
  const img = src(4800, 6000);
  const pre = runPreflight({ inspection: img, profile: p810 });
  const { spec } = planFix(img, p810, pre, { aspectMode: "crop", cropOffset: 0 });

  it("passes a correct output with the READY label", () => {
    const out = setJpegPpi(makeJpeg({ width: 2400, height: 3000, quality: 92 }), 300);
    const v = verifyOutput(out, "o.jpg", p810, spec, ctx);
    expect(v.checks.filter((c) => !c.passed)).toEqual([]);
    expect(v.status).toBe("READY");
    expect(v.label).toBe(READY_LABEL);
  });
  it("fails when the output is larger than the destination's pixel limit", () => {
    const out = setJpegPpi(makeJpeg({ width: 2400, height: 3000, quality: 92 }), 300);
    const capped = { ...p810, max_dimension_px: 2999 };
    const v = verifyOutput(out, "o.jpg", capped, spec, ctx);
    expect(v.checks.find((c) => c.name === "Largest side")?.passed).toBe(false);
    expect(v.verified).toBe(false);
    const roomy = verifyOutput(out, "o.jpg", { ...p810, max_dimension_px: 3000 }, spec, ctx);
    expect(roomy.checks.find((c) => c.name === "Largest side")?.passed).toBe(true);
  });
  it("fails when the output dimensions differ from what was requested", () => {
    const out = setJpegPpi(makeJpeg({ width: 2400, height: 2990 }), 300);
    const v = verifyOutput(out, "o.jpg", p810, spec, ctx);
    expect(v.verified).toBe(false);
    expect(v.status).toBe("UNVERIFIED");
  });
  it("fails when the print-size tag is missing", () => {
    const v = verifyOutput(makeJpeg({ width: 2400, height: 3000, jfifDpi: null }), "o.jpg", p810, spec, ctx);
    expect(v.checks.find((c) => c.name === "Print-size tag")?.passed).toBe(false);
  });
  it("fails a transparent output for a paper profile", () => {
    const png = setPngPpi(makePng({ width: 2400, height: 3000, colorType: 6 }), 300);
    const v = verifyOutput(png, "o.png", p810, spec, { ...ctx, outputAlphaUsed: true });
    expect(v.checks.find((c) => c.name === "No transparency")?.passed).toBe(false);
    expect(v.checks.find((c) => c.name === "File format")?.passed).toBe(false);
  });
  it("a valid but low-detail file is not called ready", () => {
    const small = src(900, 1125);
    const pre2 = runPreflight({ inspection: small, profile: p810 });
    const { spec: s2 } = planFix(small, p810, pre2, { aspectMode: "crop", cropOffset: 0 });
    const out = setJpegPpi(makeJpeg({ width: 900, height: 1125 }), s2.ppi);
    const v = verifyOutput(out, "o.jpg", p810, s2, ctx);
    expect(v.verified).toBe(true);
    expect(v.status).toBe("REVIEW_RECOMMENDED");
    expect(v.label).not.toBe(READY_LABEL);
  });
  it("garbage output is UNVERIFIED", () => {
    expect(verifyOutput(new Uint8Array([1, 2, 3]), "o.jpg", p810, spec, ctx).status).toBe("UNVERIFIED");
  });
});
