import { describe, expect, it } from "vitest";
import { buildCustomProfile, getGroup, listGroups, requireProfile } from "@/engine/profiles/registry";
import { validateProfile, ProfileValidationError, type PrintProfile } from "@/engine/profiles/schema";
import { INTENTS } from "@/engine/intents";

describe("profile data", () => {
  it("loads every group and validates every profile", () => {
    const groups = listGroups();
    expect(groups.map((g) => g.destination).sort()).toEqual(["etsy_printable", "photo_poster", "printful", "printify"]);
    for (const g of groups) for (const p of g.profiles) expect(() => validateProfile(p)).not.toThrow();
  });

  it("every profile carries source_url, source_type, last_verified_at and profile_version", () => {
    for (const g of listGroups()) {
      for (const p of g.profiles) {
        expect(p.source.source_url).toMatch(/^https:\/\//);
        expect(p.source.source_type).toBeTruthy();
        expect(p.source.last_verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(p.source.profile_version).toBeTruthy();
      }
    }
  });

  it("platform rules that could not be directly confirmed are flagged review_required", () => {
    for (const d of ["printful", "printify"] as const) {
      for (const p of getGroup(d)!.profiles) expect(p.source.review_required).toBe(true);
    }
    expect(getGroup("etsy_printable")!.marketplace_constraints!.source.review_required).toBe(true);
  });

  it("third-party conventions are never labelled as official platform requirements", () => {
    for (const p of getGroup("photo_poster")!.profiles) expect(p.source.source_type).toBe("printready_policy");
  });

  it("covers the standard sizes from the spec", () => {
    const ids = getGroup("photo_poster")!.profiles.map((p) => p.id);
    for (const s of ["4x6", "5x7", "8x10", "11x14", "12x18", "18x24", "24x36", "a5", "a4", "a3", "a2"]) expect(ids).toContain(`photo.${s}`);
  });

  it("covers the Etsy ratio families from the spec", () => {
    const labels = getGroup("etsy_printable")!.profiles.map((p) => p.ratio_family!.label);
    expect(labels).toEqual(["2:3", "3:4", "4:5", "5:7", "11:14", "ISO A-series"]);
  });

  it("rejects malformed profile data", () => {
    const good = requireProfile("photo.8x10");
    const bad = (patch: Partial<PrintProfile>) => () => validateProfile({ ...good, ...patch } as PrintProfile);
    expect(bad({ size: { width: 10, height: 8, unit: "in" } })).toThrow(ProfileValidationError);
    expect(bad({ ppi: { preferred: 150, minimum: 300 } })).toThrow(ProfileValidationError);
    expect(bad({ source: { ...good.source, last_verified_at: "yesterday" } })).toThrow(ProfileValidationError);
    expect(bad({ output_format: "png", accepted_formats: ["jpeg"] })).toThrow(ProfileValidationError);
    expect(bad({ transparency: "preferred" })).toThrow(ProfileValidationError); // transparency needs PNG output
  });

  it("builds custom profiles through the same schema", () => {
    const p = buildCustomProfile({ width: 30, height: 20, unit: "in" });
    expect(p.size).toEqual({ width: 20, height: 30, unit: "in" });
    expect(p.viewing_context).toBe("large_wall");
    expect(p.ppi.minimum).toBeLessThanOrEqual(p.ppi.preferred);
    const b = buildCustomProfile({ width: 210, height: 297, unit: "mm", bleed: { value: 3, unit: "mm" } });
    // Bleed gained per-side flags; a plain value still means "all four sides".
    expect(b.bleed).toEqual({ value: 3, unit: "mm", sides: { top: true, bottom: true, inside: true, outside: true } });
    const book = buildCustomProfile({
      width: 6, height: 9, unit: "in",
      bleed: { value: 3.175, unit: "mm", sides: { top: true, bottom: true, inside: false, outside: true } },
    });
    expect(book.bleed?.sides).toEqual({ top: true, bottom: true, inside: false, outside: true });
  });
});

describe("SEO intents", () => {
  it("has exactly the spec's entrances, all routed to existing profiles", () => {
    expect(INTENTS.map((i) => i.slug)).toEqual([
      "can-i-print-this", "300-dpi-image-checker", "photo-print-size-checker", "8x10-photo-resolution",
      "a4-print-resolution", "a3-print-resolution", "18x24-poster-resolution", "24x36-poster-resolution",
      "make-image-print-ready", "etsy-printable-size-generator", "etsy-printable-pack",
      "printful-image-checker", "printify-image-checker",
    ]);
    for (const i of INTENTS) if (i.profileId) expect(requireProfile(i.profileId).destination).toBe(i.destination);
  });
});
