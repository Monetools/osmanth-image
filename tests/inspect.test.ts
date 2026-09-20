import { describe, expect, it } from "vitest";
import { inspectImage, sniffFormat } from "@/engine/inspect/inspect";
import { estimateJpegQuality } from "@/engine/inspect/jpeg";
import { iccProfile, makeJpeg, makePng, makeWebpVp8x, scaledLuma } from "./fixtures";

describe("format sniffing ignores names and declared MIME", () => {
  it("detects JPEG named .png with a PNG MIME", () => {
    const r = inspectImage(makeJpeg({ width: 100, height: 80 }), "photo.png", "image/png");
    expect(r.inspection?.format).toBe("jpeg");
    expect(r.inspection?.warnings.some((w) => w.includes("claims to be image/png"))).toBe(true);
  });
  it("rejects HEIC, TIFF, PDF and random bytes with plain-language messages", () => {
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    expect(sniffFormat(heic)).toBe("heic");
    expect(inspectImage(heic, "a.jpg").error?.code).toBe("unsupported_format");
    expect(inspectImage(new Uint8Array([0x49, 0x49, 0x2a, 0, 1, 2]), "a.jpg").error?.message).toMatch(/TIFF/);
    expect(inspectImage(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "a.jpg").error?.message).toMatch(/PDF/);
    expect(inspectImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "a.jpg").error?.code).toBe("unsupported_format");
  });
});

describe("JPEG inspection", () => {
  it("reads dimensions, JFIF density and components", () => {
    const i = inspectImage(makeJpeg({ width: 3000, height: 2400, jfifDpi: 72 }), "a.jpg").inspection!;
    expect([i.width, i.height]).toEqual([3000, 2400]);
    expect(i.embeddedPpi).toEqual({ x: 72, y: 72, source: "jfif" });
    expect(i.colorModel).toBe("rgb");
  });
  it("applies EXIF orientation 6 by swapping displayed dimensions", () => {
    const i = inspectImage(makeJpeg({ width: 4000, height: 3000, exifOrientation: 6 }), "a.jpg").inspection!;
    expect([i.storedWidth, i.storedHeight]).toEqual([4000, 3000]);
    expect([i.width, i.height]).toEqual([3000, 4000]);
    expect(i.orientation).toBe(6);
  });
  it("prefers EXIF resolution over JFIF", () => {
    const i = inspectImage(makeJpeg({ width: 100, height: 100, jfifDpi: 72, exifDpi: 300 }), "a.jpg").inspection!;
    expect(i.embeddedPpi).toEqual({ x: 300, y: 300, source: "exif" });
  });
  it("estimates JPEG quality from quantisation tables", () => {
    for (const q of [30, 50, 75, 85, 95]) {
      expect(Math.abs(estimateJpegQuality(scaledLuma(q)) - q)).toBeLessThanOrEqual(1);
    }
    const q = inspectImage(makeJpeg({ width: 20, height: 20, quality: 60 }), "a.jpg").inspection!.jpegQuality!;
    expect(Math.abs(q - 60)).toBeLessThanOrEqual(1);
  });
  it("detects CMYK / YCCK and ICC descriptions", () => {
    const cmyk = inspectImage(makeJpeg({ width: 64, height: 64, components: 4, adobeTransform: 0, icc: iccProfile("CMYK", "U.S. Web Coated (SWOP) v2") }), "c.jpg").inspection!;
    expect(cmyk.colorModel).toBe("cmyk");
    expect(cmyk.icc?.family).toBe("CMYK");
    const ycck = inspectImage(makeJpeg({ width: 64, height: 64, components: 4, adobeTransform: 2 }), "c.jpg").inspection!;
    expect(ycck.colorModel).toBe("ycck");
    const adobe = inspectImage(makeJpeg({ width: 64, height: 64, icc: iccProfile("RGB ", "Adobe RGB (1998)") }), "c.jpg").inspection!;
    expect(adobe.icc?.family).toBe("Adobe RGB");
  });
  it("reports malformed JPEGs instead of throwing", () => {
    const good = makeJpeg({ width: 100, height: 100 });
    const truncated = good.subarray(0, 30);
    const r = inspectImage(truncated, "t.jpg");
    expect(r.inspection).toBeNull();
    expect(r.error?.code).toBe("malformed");
  });
  it("survives a corrupt EXIF block", () => {
    const j = makeJpeg({ width: 50, height: 60, exifOrientation: 6 });
    // Corrupt the IFD offset inside the EXIF TIFF header.
    const idx = j.findIndex((_, k) => j[k] === 0x4d && j[k + 1] === 0x4d && j[k + 2] === 0 && j[k + 3] === 42);
    j[idx + 4] = 0xff;
    const i = inspectImage(j, "x.jpg").inspection!;
    expect([i.width, i.height]).toEqual([50, 60]);
    expect(i.orientation).toBe(1);
  });
});

describe("PNG inspection", () => {
  it("reads alpha, pHYs PPI and compressed ICC", () => {
    const i = inspectImage(makePng({ width: 1200, height: 1800, colorType: 6, ppi: 300, iccDescription: "Display P3" }), "a.png").inspection!;
    expect(i.hasAlphaChannel).toBe(true);
    expect(i.embeddedPpi!.x).toBeCloseTo(300, 0);
    expect(i.icc?.family).toBe("Display P3");
  });
  it("RGB PNG without tRNS has no alpha channel", () => {
    expect(inspectImage(makePng({ width: 10 * 4, height: 40 }), "a.png").inspection!.hasAlphaChannel).toBe(false);
  });
});

describe("WebP inspection", () => {
  it("reads VP8X canvas size and alpha flag", () => {
    const i = inspectImage(makeWebpVp8x(5000, 4000, true), "w.webp").inspection!;
    expect([i.width, i.height, i.hasAlphaChannel]).toEqual([5000, 4000, true]);
  });
});

describe("security limits (checked from headers, before decoding)", () => {
  it("rejects a decompression bomb by header pixel count", () => {
    const r = inspectImage(makePng({ width: 20000, height: 20000 }), "bomb.png");
    expect(r.error?.code).toBe("limit");
    expect(r.error?.violation?.code).toBe("too_many_pixels");
  });
  it("rejects an over-long dimension", () => {
    const r = inspectImage(makePng({ width: 40000, height: 100 }), "long.png");
    expect(r.error?.violation?.code).toBe("dimension_too_large");
  });
  it("rejects tiny images", () => {
    expect(inspectImage(makePng({ width: 8, height: 8 }), "tiny.png").error?.violation?.code).toBe("too_small");
  });
});
