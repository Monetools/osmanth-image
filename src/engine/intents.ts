import type { DestinationId } from "./profiles/schema";

/**
 * SEO entrances (spec §21). Each slug is DATA that preselects destination/profile for the single
 * shared workflow. There is exactly one tool implementation; landing pages only differ in copy.
 */
export interface Intent {
  slug: string;
  title: string;
  h1: string;
  description: string;
  intro: string;
  destination?: DestinationId;
  profileId?: string;
  /** Start the Etsy pack flow instead of a single-size check. */
  etsyPack?: boolean;
}

export const INTENTS: Intent[] = [
  {
    slug: "can-i-print-this", title: "Can I print this image? — Free print checker",
    h1: "Can I print this image?", description: "Upload an image and see whether it will print well at the size you want — free, in your browser.",
    intro: "Tell us where you're printing. We'll check the file and tell you, in plain words, whether it will look good.",
  },
  {
    slug: "300-dpi-image-checker", title: "300 DPI image checker — real print resolution",
    h1: "Is my image really 300 DPI?", description: "Check the real print resolution of an image for any print size. Changing the DPI setting alone doesn't add detail — we measure the pixels.",
    intro: "The \"DPI\" number stored in a file doesn't decide print quality — the number of pixels does. Upload your image and choose a size to see the real result.",
    destination: "photo_poster",
  },
  {
    slug: "photo-print-size-checker", title: "Photo print size checker — how big can I print?",
    h1: "How big can I print this photo?", description: "Find the largest size your photo prints well at, from 4×6 to 24×36 posters.",
    intro: "Upload a photo and we'll show which print sizes it can handle, and which would look soft.", destination: "photo_poster",
  },
  {
    slug: "8x10-photo-resolution", title: "8×10 photo resolution checker",
    h1: "Is my photo good enough for an 8×10 print?", description: "Check whether your image has enough detail for an 8×10 inch print and fix cropping and file problems.",
    intro: "8×10 prints are usually seen up close. Upload your image to check it.", destination: "photo_poster", profileId: "photo.8x10",
  },
  {
    slug: "a4-print-resolution", title: "A4 print resolution checker",
    h1: "Will my image print well on A4?", description: "Check an image for A4 printing: resolution, crop and file format.",
    intro: "Upload an image to check it against A4 (210 × 297 mm).", destination: "photo_poster", profileId: "photo.a4",
  },
  {
    slug: "a3-print-resolution", title: "A3 print resolution checker",
    h1: "Will my image print well on A3?", description: "Check an image for A3 printing and prepare a print-ready file.",
    intro: "Upload an image to check it against A3 (297 × 420 mm).", destination: "photo_poster", profileId: "photo.a3",
  },
  {
    slug: "18x24-poster-resolution", title: "18×24 poster resolution checker",
    h1: "Is my image big enough for an 18×24 poster?", description: "Check an image for an 18×24 inch poster and prepare the file.",
    intro: "Posters are seen from further away, so they need fewer pixels per inch than small photos. Upload to check.", destination: "photo_poster", profileId: "photo.18x24",
  },
  {
    slug: "24x36-poster-resolution", title: "24×36 poster resolution checker",
    h1: "Is my image big enough for a 24×36 poster?", description: "Check an image for a 24×36 inch poster and prepare the file.",
    intro: "Upload an image to see whether it can fill a 24×36 poster.", destination: "photo_poster", profileId: "photo.24x36",
  },
  {
    slug: "make-image-print-ready", title: "Make an image print-ready",
    h1: "Make your image print-ready", description: "Crop, convert and prepare an image for printing, then check the finished file again before you download it.",
    intro: "Choose where you're printing and we'll prepare the file, then check the finished file again.",
  },
  {
    slug: "etsy-printable-size-generator", title: "Etsy printable size generator",
    h1: "Create every Etsy printable size from one artwork", description: "Generate 2:3, 3:4, 4:5, 5:7, 11:14 and A-series printable files without stretching.",
    intro: "Upload your artwork and we'll plan each ratio file, show exactly what gets cropped, and package everything for your listing.",
    destination: "etsy_printable", etsyPack: true,
  },
  {
    slug: "etsy-printable-pack", title: "Etsy printable pack — ready-to-list files",
    h1: "Build your Etsy printable pack", description: "One upload, every ratio file, packaged for an Etsy digital download. We tell you if we couldn't confirm Etsy's limits.",
    intro: "Upload artwork and get a complete, checked set of printable files.", destination: "etsy_printable", etsyPack: true,
  },
  {
    slug: "printful-image-checker", title: "Printful image checker",
    h1: "Check your image for Printful", description: "Check a design for Printful posters and t-shirts before you upload it. Where we can't confirm Printful's own requirements, we say so.",
    intro: "Pick a Printful product and we'll check your file against the requirements we have on record, and tell you if we couldn't confirm them.", destination: "printful",
  },
  {
    slug: "printify-image-checker", title: "Printify image checker",
    h1: "Check your image for Printify", description: "Check a design for Printify posters and t-shirts before you upload it. Where we can't confirm Printify's own requirements, we say so.",
    intro: "Pick a Printify product and we'll check your file against the requirements we have on record, and tell you if we couldn't confirm them.", destination: "printify",
  },
];

export function getIntent(slug: string): Intent | undefined {
  return INTENTS.find((i) => i.slug === slug);
}
