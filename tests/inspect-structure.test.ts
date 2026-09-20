import { describe, expect, it } from "vitest";
import { inspectImage } from "@/engine/inspect/inspect";
import { isMislabelledSrgb, parseIcc } from "@/engine/inspect/icc";
import { iccProfile, makeJpeg, makePng, SRGB_XYZ, WIDE_XYZ } from "./fixtures";

/**
 * Capabilities adopted from the sibling CheckBeforeSubmit engine (colorant-based sRGB decision,
 * JPEG structure/truncation reporting) plus PrintReady's own line-art detection.
 */

describe("ICC: colorants decide sRGB, not the profile name", () => {
  it("a renamed sRGB profile is still sRGB", () => {
    const icc = iccProfile("RGB ", "Camera Profile 42", SRGB_XYZ);
    const i = inspectImage(makeJpeg({ width: 100, height: 100, icc }), "a.jpg").inspection!;
    expect(i.icc?.primariesMatchSrgb).toBe(true);
    expect(i.icc?.family).toBe("sRGB");
    expect(isMislabelledSrgb(i.icc)).toBe(false);
  });

  it("a profile that merely claims sRGB but has wide-gamut colorants is not sRGB", () => {
    const icc = iccProfile("RGB ", "sRGB IEC61966-2.1", WIDE_XYZ);
    const i = inspectImage(makeJpeg({ width: 100, height: 100, icc }), "a.jpg").inspection!;
    expect(i.icc?.primariesMatchSrgb).toBe(false);
    expect(i.icc?.family).not.toBe("sRGB");
    expect(isMislabelledSrgb(i.icc)).toBe(true);
  });

  it("falls back to the description when a profile has no colorants", () => {
    const i = inspectImage(makeJpeg({ width: 100, height: 100, icc: iccProfile("RGB ", "Adobe RGB (1998)") }), "a.jpg").inspection!;
    expect(i.icc?.primariesMatchSrgb).toBeUndefined();
    expect(i.icc?.family).toBe("Adobe RGB");
  });

  it("CMYK and grayscale profiles are classified by their header space", () => {
    const cmyk = inspectImage(makeJpeg({ width: 64, height: 64, components: 4, adobeTransform: 0, icc: iccProfile("CMYK", "Coated FOGRA39") }), "c.jpg").inspection!;
    expect(cmyk.icc?.family).toBe("CMYK");
    expect(cmyk.icc?.primariesMatchSrgb).toBeUndefined();
    const gray = parseIcc(new Uint8Array(iccProfile("GRAY", "Dot Gain 20%")));
    expect(gray.family).toBe("Gray");
  });

  it("non-ICC bytes are reported as unreadable rather than guessed", () => {
    const junk = parseIcc(new Uint8Array(200).fill(7));
    expect(junk.readable).toBe(false);
    expect(junk.family).toBe("Other");
  });
});

describe("JPEG structure and integrity", () => {
  it("reassembles a multi-segment ICC profile", () => {
    const icc = iccProfile("RGB ", "Big Profile", SRGB_XYZ);
    const i = inspectImage(makeJpeg({ width: 80, height: 80, icc, iccChunks: 3 }), "a.jpg").inspection!;
    expect(i.icc?.family).toBe("sRGB");
    expect(i.structureProblems).toEqual([]);
  });

  it("refuses to trust an incomplete ICC profile", () => {
    const icc = iccProfile("RGB ", "Big Profile", SRGB_XYZ);
    const i = inspectImage(makeJpeg({ width: 80, height: 80, icc, iccChunks: 3, iccDropLastChunk: true }), "a.jpg").inspection!;
    expect(i.icc).toBeNull();
    expect(i.structureProblems.join(" ")).toMatch(/colour profile is incomplete/);
  });

  it("detects a truncated file (no end-of-image marker)", () => {
    const whole = inspectImage(makeJpeg({ width: 120, height: 90 }), "a.jpg").inspection!;
    expect(whole.complete).toBe(true);
    expect(whole.structureProblems).toEqual([]);
    const cut = inspectImage(makeJpeg({ width: 120, height: 90, noEoi: true }), "a.jpg").inspection!;
    expect(cut.complete).toBe(false);
    expect(cut.structureProblems.join(" ")).toMatch(/truncated/);
    // Dimensions are still usable — a truncated file is reported, not thrown away.
    expect([cut.width, cut.height]).toEqual([120, 90]);
  });

  it("reads frame type and chroma subsampling", () => {
    const base = inspectImage(makeJpeg({ width: 64, height: 64 }), "a.jpg").inspection!;
    expect(base.frameType).toBe("baseline");
    expect(base.subsampling).toBe("4:4:4");
    const prog = inspectImage(makeJpeg({ width: 64, height: 64, progressive: true, sampling: [[2, 2], [1, 1], [1, 1]] }), "a.jpg").inspection!;
    expect(prog.frameType).toBe("progressive");
    expect(prog.progressive).toBe(true);
    expect(prog.subsampling).toBe("4:2:0");
    const j422 = inspectImage(makeJpeg({ width: 64, height: 64, sampling: [[2, 1], [1, 1], [1, 1]] }), "a.jpg").inspection!;
    expect(j422.subsampling).toBe("4:2:2");
  });

  it("reads the EXIF ColorSpace tag", () => {
    const i = inspectImage(makeJpeg({ width: 64, height: 64, exifColorSpace: 1 }), "a.jpg").inspection!;
    expect(i.exifColorSpace).toBe(1);
    const none = inspectImage(makeJpeg({ width: 64, height: 64 }), "a.jpg").inspection!;
    expect(none.exifColorSpace).toBeNull();
  });

  it("never throws on arbitrary bytes", () => {
    for (let n = 0; n < 200; n++) {
      const len = (n * 97) % 3000;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 31 + n * 7) % 256;
      if (len > 3) {
        bytes[0] = 0xff;
        bytes[1] = 0xd8;
        bytes[2] = 0xff;
      }
      expect(() => inspectImage(bytes, "fuzz.jpg")).not.toThrow();
    }
  });
});

describe("PNG structure and line art", () => {
  it("detects 1-bit and 2-bit palette artwork as line art", () => {
    expect(inspectImage(makePng({ width: 600, height: 400, colorType: 0, bitDepth: 1 }), "a.png").inspection!.lineArt).toBe(true);
    expect(inspectImage(makePng({ width: 600, height: 400, colorType: 3, bitDepth: 2 }), "a.png").inspection!.lineArt).toBe(true);
  });

  it("does not call photographs line art", () => {
    expect(inspectImage(makePng({ width: 600, height: 400 }), "a.png").inspection!.lineArt).toBe(false);
    expect(inspectImage(makeJpeg({ width: 600, height: 400 }), "a.jpg").inspection!.lineArt).toBe(false);
  });

  it("detects a PNG with no IEND chunk", () => {
    const cut = inspectImage(makePng({ width: 300, height: 300, noIend: true }), "a.png").inspection!;
    expect(cut.complete).toBe(false);
    expect(cut.structureProblems.join(" ")).toMatch(/truncated/);
  });
});
