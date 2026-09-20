import { describe, expect, it } from "vitest";
import { evaluateGate, requiredCredits, type Entitlement } from "@/engine/enhance/costGate";
import { routeEnhancement } from "@/engine/enhance/router";
import { RealEsrganSelfHosted, defaultProviders } from "@/engine/enhance/providers";
import type { EnhancementJob, EnhancementProvider } from "@/engine/enhance/provider";
import { inspectImage } from "@/engine/inspect/inspect";
import { getGroup } from "@/engine/profiles/registry";
import { packageUploads, planEtsyPack, sanitizeFileName, PackError } from "@/engine/etsy/pack";
import { makeJpeg } from "./fixtures";

const job = (o: Partial<EnhancementJob> = {}): EnhancementJob => ({
  inputWidth: 1200, inputHeight: 1500, scale: 2, imageKind: "photo", hasFaces: false, faceRestoration: false,
  mode: "full", quality: "standard", ...o,
});
const anon: Entitlement = { userId: null, anonymous: true, credits: 0, freePreviewsRemaining: 3 };
const paid: Entitlement = { userId: "u1", anonymous: false, credits: 100, freePreviewsRemaining: 3 };
const measured = { usd: 0.012, seconds: 4, measured: true };

describe("cost gate", () => {
  it("never runs full-resolution work for anonymous users", () => {
    const d = evaluateGate(job(), measured, anon);
    expect(d).toMatchObject({ allowed: false, reason: "anonymous_full_resolution" });
    expect(d.required_credits).toBe(2);
    expect(d.estimated_compute_cost).toBe(0.012);
  });
  it("refuses unmeasured (placeholder) costs", () => {
    expect(evaluateGate(job(), { ...measured, measured: false }, paid).reason).toBe("cost_not_measured");
  });
  it("requires enough credits", () => {
    expect(evaluateGate(job(), measured, { ...paid, credits: 1 }).reason).toBe("insufficient_credits");
    expect(evaluateGate(job(), measured, paid)).toMatchObject({ allowed: true, reason: "ok_paid" });
  });
  it("free previews are small crops only, with a quota", () => {
    expect(evaluateGate(job({ mode: "preview", inputWidth: 256, inputHeight: 256 }), measured, anon).reason).toBe("ok_free_preview");
    expect(evaluateGate(job({ mode: "preview", inputWidth: 1200, inputHeight: 1500 }), measured, anon).reason).toBe("preview_too_large");
    expect(evaluateGate(job({ mode: "preview", inputWidth: 200, inputHeight: 200 }), measured, { ...anon, freePreviewsRemaining: 0 }).reason).toBe("preview_quota_exhausted");
  });
  it("rounds credits up", () => {
    expect(requiredCredits({ usd: 0.0001, seconds: 1, measured: true })).toBe(1);
    expect(requiredCredits({ usd: 0.051, seconds: 1, measured: true })).toBe(6);
  });
});

describe("enhancement router", () => {
  it("selects nothing while no provider has passed the benchmark and licence gates", () => {
    const d = routeEnhancement(job(), defaultProviders());
    expect(d.provider).toBeNull();
    expect(d.rejected[0].reason).toMatch(/benchmark/);
  });
  it("the default Real-ESRGAN provider's cost is a placeholder until measured", () => {
    expect(new RealEsrganSelfHosted("http://x", "t").estimate(job()).measured).toBe(false);
  });
  it("prefers providers suited to the image type and cheaper cost", () => {
    const fake = (id: string, usd: number, goodFor: EnhancementJob["imageKind"][]): EnhancementProvider => ({
      id, kind: "external_api", model: id, supportedScales: [2, 4], maxInputPixels: 1e8, goodFor,
      gates: () => ({ benchmarked: true, licenseCleared: true, configured: true }),
      estimate: () => ({ usd, seconds: 5, measured: true }),
      run: async () => { throw new Error("not in tests"); },
    });
    const d = routeEnhancement(job({ imageKind: "graphic_text" }), [fake("photo-cheap", 0.001, ["photo"]), fake("text-ok", 0.01, ["graphic_text"])]);
    expect(d.provider?.id).toBe("text-ok");
  });
});

describe("Etsy printable pack", () => {
  const group = getGroup("etsy_printable")!;
  const art = inspectImage(makeJpeg({ width: 4800, height: 7200, quality: 95 }), "My Sunset Print (final).jpg").inspection!;

  it("plans one file per ratio family without stretching", () => {
    const plan = planEtsyPack(art, group);
    expect(plan.items).toHaveLength(6);
    const r23 = plan.items.find((i) => i.profile.id === "etsy.2x3")!;
    expect(r23.loss).toBe(0);
    for (const it of plan.items) {
      const { canvas, source } = it.plan.spec;
      expect(Math.abs(canvas.w / canvas.h - source.w / source.h)).toBeLessThan(0.002);
    }
  });
  it("reports which family sizes each file actually supports", () => {
    const r23 = planEtsyPack(art, group).items.find((i) => i.profile.id === "etsy.2x3")!;
    // 4800 px wide: 24×36 → 200 PPI (ok, min 150); every size should pass.
    expect(r23.sizes.find((s) => s.label === "24×36 in")!.effectivePpi).toBe(200);
    expect(r23.largestGoodSize).toBe("24×36 in");
  });
  it("requires a decision when a ratio would lose substantial content", () => {
    const wide = inspectImage(makeJpeg({ width: 6000, height: 3000 }), "pano.jpg").inspection!;
    const plan = planEtsyPack(wide, group);
    expect(plan.pendingDecisions).toBeGreaterThan(0);
    const id = plan.items.find((i) => i.needsDecision)!.profile.id;
    const after = planEtsyPack(wide, group, {}, { [id]: true });
    expect(after.pendingDecisions).toBe(plan.pendingDecisions - 1);
  });
  it("sanitises filenames to marketplace rules", () => {
    const n = sanitizeFileName("My Sunset Print (final).jpg", "2x3", "jpg");
    expect(n).toBe("My-Sunset-Print-final_2x3.jpg");
    expect(sanitizeFileName("x".repeat(200), "ISO-A", "jpg").length).toBeLessThanOrEqual(70);
    expect(sanitizeFileName("日本語.png", "4x5", "jpg")).toBe("artwork_4x5.jpg");
  });
  it("bundles six files into ≤5 uploads of ≤20MB", () => {
    const c = group.marketplace_constraints!;
    const files = ["a", "b", "c", "d", "e", "f"].map((n) => ({ name: `${n}.jpg`, bytes: new Uint8Array(6 * 1024 * 1024) }));
    const ups = packageUploads(files, c, "art");
    expect(ups.length).toBeLessThanOrEqual(5);
    for (const u of ups) expect(u.bytes.length).toBeLessThanOrEqual(c.max_file_size_bytes);
    expect(ups.flatMap((u) => u.contains).sort()).toEqual(files.map((f) => f.name).sort());
  });
  it("refuses a single file over the limit", () => {
    const c = group.marketplace_constraints!;
    expect(() => packageUploads([{ name: "big.jpg", bytes: new Uint8Array(21 * 1024 * 1024) }], c, "art")).toThrow(PackError);
  });
});
