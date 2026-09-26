import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectImage } from "@/engine/inspect/inspect";
import { requireProfile } from "@/engine/profiles/registry";
import { runPreflight } from "@/engine/preflight/preflight";
import { INTENTS } from "@/engine/intents";
import { makeJpeg } from "./fixtures";

/**
 * Product scope, decided 2026-09-21:
 *   - Osmanth Image handles IMAGES; PDFs belong to the sibling product, Check Before Submit.
 *   - There is no AI enlargement. Too few pixels can only be answered with "print smaller".
 */
describe("PDFs are sent to Check Before Submit", () => {
  it("explains the split and links to the sibling site", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const r = inspectImage(pdf, "flyer.pdf", "application/pdf");
    expect(r.inspection).toBeNull();
    expect(r.error?.code).toBe("unsupported_format");
    expect(r.error?.message).toMatch(/Check Before Submit/);
    expect(r.error?.link?.href).toBe("https://checkbeforesubmit.com/");
  });

  it("other unsupported formats get no sibling link", () => {
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    expect(inspectImage(heic, "a.heic").error?.link).toBeUndefined();
  });
});

describe("no AI enlargement", () => {
  const img = (w: number, h: number) => inspectImage(makeJpeg({ width: w, height: h, quality: 92 }), "a.jpg").inspection!;

  it("too few pixels is always a decision (print smaller), never an AI fix", () => {
    for (const [w, h] of [[1200, 1500], [700, 875], [300, 375]]) {
      const r = runPreflight({ inspection: img(w, h), profile: requireProfile("photo.8x10") });
      for (const i of r.issues) expect(["auto", "decision", "none"]).toContain(i.resolution);
      const res = r.issues.find((i) => i.category === "resolution")!;
      expect(res.resolution).toBe("decision");
      expect(res.detail).toMatch(/prints well up to about/);
      expect(`${res.title} ${res.detail}`).not.toMatch(/\bAI\b|enlarg|upscal/i);
    }
  });

  it("low resolution is never presented as fixable", () => {
    const r = runPreflight({ inspection: img(1200, 1500), profile: requireProfile("photo.8x10") });
    expect(r.status).toBe("REVIEW_RECOMMENDED");
  });

  it("there is no upscaling landing page", () => {
    expect(INTENTS.some((i) => /upscal|enhanc/i.test(`${i.slug} ${i.title} ${i.description}`))).toBe(false);
  });

  it("the app has no server API and no enhancement code left", () => {
    const root = join(__dirname, "..");
    expect(existsSync(join(root, "src/app/api"))).toBe(false);
    expect(existsSync(join(root, "src/engine/enhance"))).toBe(false);
    expect(existsSync(join(root, "src/server"))).toBe(false);
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\/api\/enhance|enhancementScale|enhancementAvailable/);
      // No user-facing copy may still promise AI enlargement.
      expect(text, f).not.toMatch(/AI enlargement|AI enhancement/i);
    }
  });
});
