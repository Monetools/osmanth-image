import { startsWith } from "./bytes";
import { jpegEmbeddedPpi, parseJpeg } from "./jpeg";
import { parsePng, pngColorModel, pngHasAlphaChannel, pngIsLineArt, PNG_SIG } from "./png";
import { parseWebp } from "./webp";
import { exifPpi } from "./exif";
import type { DetectedFormat, ImageInspection } from "./types";
import { checkLimits, type LimitViolation } from "../security/limits";

export type { ImageInspection } from "./types";

/** Identify a file by its leading bytes. Filename extensions and declared MIME types are never trusted. */
export function sniffFormat(bytes: Uint8Array): DetectedFormat {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, PNG_SIG)) return "png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (/^(avif|avis)$/.test(brand)) return "avif";
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return "heic";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return "unknown";
}

const SUPPORTED: DetectedFormat[] = ["jpeg", "png", "webp"];

export const UNSUPPORTED_MESSAGES: Partial<Record<DetectedFormat, string>> = {
  heic: "iPhone HEIC photos can't be processed here yet. On your iPhone, share the photo as JPEG (or set Camera → Formats → Most Compatible) and upload that.",
  avif: "AVIF files aren't supported yet. Please export the image as JPEG or PNG.",
  tiff: "TIFF files aren't supported in the browser yet. Please export the image as a high-quality JPEG or PNG.",
  gif: "GIF is a low-colour format that isn't suitable for printing. Please use the original JPEG or PNG.",
  bmp: "BMP files aren't supported. Please export the image as PNG.",
  pdf: "Osmanth Image prepares image files (JPEG, PNG, WebP). To check a PDF before printing, use Check Before Submit.",
  svg: "Vector (SVG) files aren't supported yet. Export a PNG at the size you want to print.",
  unknown: "This doesn't look like an image file we can read. Please upload a JPEG, PNG or WebP.",
};

/** Where to send people whose file belongs to our sibling product. */
export const UNSUPPORTED_LINKS: Partial<Record<DetectedFormat, { label: string; href: string }>> = {
  pdf: { label: "Check a PDF at Check Before Submit", href: "https://checkbeforesubmit.com/" },
};

export interface InspectResult {
  inspection: ImageInspection | null;
  error: {
    code: "unsupported_format" | "malformed" | "limit";
    message: string;
    violation?: LimitViolation;
    link?: { label: string; href: string };
  } | null;
}

function orientDims(w: number, h: number, orientation: number): [number, number] {
  return orientation >= 5 && orientation <= 8 ? [h, w] : [w, h];
}

/**
 * Inspect an image from its bytes only. Runs identically in the browser (no upload) and in Node.
 * Reads headers/metadata — it never decodes pixels.
 */
export function inspectImage(bytes: Uint8Array, fileName = "image", declaredMime: string | null = null): InspectResult {
  const format = sniffFormat(bytes);
  const base: ImageInspection = {
    format, supported: SUPPORTED.includes(format), fileName, fileSizeBytes: bytes.length, declaredMime,
    storedWidth: 0, storedHeight: 0, orientation: 1, width: 0, height: 0, hasAlphaChannel: false,
    colorModel: "unknown", bitDepth: null, embeddedPpi: null, icc: null, srgbChunk: false,
    jpegQuality: null, progressive: false, animated: false, frameType: null, subsampling: null,
    exifColorSpace: null, complete: true, structureProblems: [], lineArt: false, warnings: [],
  };
  if (!base.supported) {
    return {
      inspection: null,
      error: {
        code: "unsupported_format",
        message: UNSUPPORTED_MESSAGES[format] ?? UNSUPPORTED_MESSAGES.unknown!,
        link: UNSUPPORTED_LINKS[format],
      },
    };
  }
  const i = base;
  try {
    if (format === "jpeg") {
      const j = parseJpeg(bytes);
      i.storedWidth = j.width;
      i.storedHeight = j.height;
      i.orientation = j.exif?.orientation ?? 1;
      i.bitDepth = j.precision;
      i.colorModel = j.components === 1 ? "gray" : j.components === 4 ? (j.adobeTransform === 2 ? "ycck" : "cmyk") : "rgb";
      i.embeddedPpi = jpegEmbeddedPpi(j);
      i.icc = j.icc;
      i.jpegQuality = j.quality;
      i.progressive = j.progressive;
      i.frameType = j.frameType;
      i.subsampling = j.subsampling;
      i.exifColorSpace = j.exif?.colorSpace ?? null;
      i.complete = j.complete;
      i.structureProblems = j.problems;
    } else if (format === "png") {
      const p = parsePng(bytes);
      i.storedWidth = p.width;
      i.storedHeight = p.height;
      i.orientation = p.exif?.orientation ?? 1;
      i.bitDepth = p.bitDepth;
      i.colorModel = pngColorModel(p);
      i.hasAlphaChannel = pngHasAlphaChannel(p);
      i.embeddedPpi = p.physPpi ? { ...p.physPpi, source: "png-phys" } : null;
      i.icc = p.icc;
      i.srgbChunk = p.srgb;
      i.animated = p.animated;
      i.complete = p.complete;
      i.structureProblems = p.problems;
      i.lineArt = pngIsLineArt(p);
    } else {
      const w = parseWebp(bytes);
      i.storedWidth = w.width;
      i.storedHeight = w.height;
      i.orientation = w.exif?.orientation ?? 1;
      i.colorModel = "rgb";
      i.hasAlphaChannel = w.hasAlpha;
      i.icc = w.icc;
      i.animated = w.animated;
      i.exifColorSpace = w.exif?.colorSpace ?? null;
      const e = w.exif ? exifPpi(w.exif) : null;
      i.embeddedPpi = e ? { ...e, source: "exif" } : null;
    }
  } catch (e) {
    return {
      inspection: null,
      error: { code: "malformed", message: "This image file appears to be damaged or incomplete, so we can't read it safely." },
    };
  }
  [i.width, i.height] = orientDims(i.storedWidth, i.storedHeight, i.orientation);
  if (i.animated) i.warnings.push("Animated image: only the first frame will be used.");
  if (declaredMime && declaredMime !== `image/${format}` && !(format === "jpeg" && declaredMime === "image/jpg")) {
    i.warnings.push(`File claims to be ${declaredMime} but its contents are ${format.toUpperCase()}; treated as ${format.toUpperCase()}.`);
  }
  const violation = checkLimits(bytes.length, i.storedWidth, i.storedHeight);
  if (violation) {
    return { inspection: i, error: { code: "limit", message: limitMessage(violation), violation } };
  }
  return { inspection: i, error: null };
}

function limitMessage(v: LimitViolation): string {
  switch (v.code) {
    case "file_too_large":
      return `This file is ${(v.actual / 1048576).toFixed(0)} MB; the limit is ${(v.limit / 1048576).toFixed(0)} MB.`;
    case "too_many_pixels":
      return `This image has ${(v.actual / 1e6).toFixed(0)} megapixels; the limit is ${(v.limit / 1e6).toFixed(0)} MP.`;
    case "dimension_too_large":
      return `This image is ${v.actual} pixels on its long side; the limit is ${v.limit}.`;
    case "too_small":
      return `This image is only ${v.actual} pixels on its short side — too small to print.`;
  }
}
