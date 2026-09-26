import { describe, expect, it } from "vitest";
import { inspectImage } from "@/engine/inspect/inspect";
import { getGroup } from "@/engine/profiles/registry";
import { packageUploads, planEtsyPack, sanitizeFileName, PackError } from "@/engine/etsy/pack";
import { makeJpeg } from "./fixtures";

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
