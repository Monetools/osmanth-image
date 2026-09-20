export type DetectedFormat = "jpeg" | "png" | "webp" | "gif" | "tiff" | "heic" | "avif" | "bmp" | "pdf" | "svg" | "unknown";

export interface EmbeddedPpi {
  x: number;
  y: number;
  source: "jfif" | "exif" | "png-phys";
}

export interface IccInfo {
  colorSpace: "RGB" | "CMYK" | "GRAY" | "LAB" | "OTHER";
  description: string | null;
  sizeBytes: number;
  /** Classification from the colorants where available, from the description otherwise. */
  family: "sRGB" | "Display P3" | "Adobe RGB" | "ProPhoto RGB" | "CMYK" | "Gray" | "Other";
  /**
   * rXYZ/gXYZ/bXYZ compared against sRGB primaries. undefined = the profile has no colorants
   * (e.g. a CMYK or LUT-based profile), so the name is all we have.
   */
  primariesMatchSrgb?: boolean;
  colorants?: { r: [number, number, number]; g: [number, number, number]; b: [number, number, number] };
  /** False when the bytes could not be parsed as an ICC profile at all. */
  readable: boolean;
}

export interface ImageInspection {
  format: DetectedFormat;
  /** Formats this product can decode and process in the browser. */
  supported: boolean;
  fileName: string;
  fileSizeBytes: number;
  declaredMime: string | null;
  /** Stored pixel dimensions (before EXIF orientation). */
  storedWidth: number;
  storedHeight: number;
  /** EXIF orientation 1–8 (1 = upright). */
  orientation: number;
  /** Dimensions as the image is meant to be viewed (after orientation). */
  width: number;
  height: number;
  /** The file format can carry an alpha channel AND this file declares one. Actual use is checked separately. */
  hasAlphaChannel: boolean;
  colorModel: "rgb" | "gray" | "indexed" | "cmyk" | "ycck" | "unknown";
  bitDepth: number | null;
  embeddedPpi: EmbeddedPpi | null;
  icc: IccInfo | null;
  /** PNG sRGB chunk present. */
  srgbChunk: boolean;
  /** Estimated libjpeg-equivalent quality (JPEG only). */
  jpegQuality: number | null;
  progressive: boolean;
  animated: boolean;
  /** JPEG frame type from the SOF marker. */
  frameType: "baseline" | "extended" | "progressive" | "lossless" | "arithmetic" | "other" | null;
  /** Chroma subsampling, e.g. "4:4:4", "4:2:0" (JPEG only). */
  subsampling: string | null;
  /** EXIF ColorSpace tag: 1 = sRGB, 65535 = uncalibrated. */
  exifColorSpace: number | null;
  /**
   * The container was parsed end-to-end: dimensions were read AND the file ends properly
   * (JPEG EOI / PNG IEND). False means the file is truncated or damaged.
   */
  complete: boolean;
  /** Structural problems found while parsing (truncation, incomplete ICC, duplicate frame header). */
  structureProblems: string[];
  /**
   * Line art: 1-bit (or near-1-bit indexed) artwork, which needs more pixels per inch than a
   * photograph to print cleanly. null = the format cannot tell us (JPEG is never line art).
   */
  lineArt: boolean;
  warnings: string[];
}
