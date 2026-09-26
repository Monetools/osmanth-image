/**
 * Site identity. One place, so the name, domain and wording cannot drift between pages, metadata,
 * the sitemap and the post-build checks.
 */

export const SITE_NAME = "Osmanth Image";

/**
 * Canonical origin, without a trailing slash. `osmanthimage.com` is the official domain in the
 * Brand Asset Kit; `www.` is expected to redirect to it at the host. Override for previews with
 * NEXT_PUBLIC_SITE_URL.
 */
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://osmanthimage.com").replace(/\/+$/, "");

export const TAGLINE = "Tell us where you're printing. We'll prepare the file.";

export const DESCRIPTION =
  "Tell us where you're printing. We check your image, fix what can be fixed, and give you a file that's ready to print. " +
  "Free, and your image never leaves your device.";

/** Brand rule: exactly this text, never paraphrased, never translated on an English page. */
export const ENDORSEMENT = "An Osmanth product";

/** The sibling product that owns PDFs. Images are ours; PDFs are theirs. */
export const SIBLING = { name: "Check Before Submit", href: "https://checkbeforesubmit.com/" } as const;

export function pageUrl(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean ? `${SITE_ORIGIN}/${clean}/` : `${SITE_ORIGIN}/`;
}
