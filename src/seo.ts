import type { Metadata } from "next";
import { DESCRIPTION, pageUrl, SITE_NAME, TAGLINE } from "@/site";

/**
 * Next.js replaces (not merges) `openGraph` and `twitter` when a page sets them, so every page
 * builds its full set here. That keeps og:title, og:url and the canonical link consistent per page
 * instead of inheriting the home page's.
 */
const OG_IMAGE = { url: "/brand/og.png", width: 1200, height: 630, alt: `${SITE_NAME} — ${TAGLINE}` };

export function pageMetadata(opts: { path: string; title?: string; description?: string }): Metadata {
  const description = opts.description ?? DESCRIPTION;
  const fullTitle = opts.title ? `${opts.title} | ${SITE_NAME}` : `${SITE_NAME} — ${TAGLINE}`;
  return {
    ...(opts.title ? { title: opts.title } : {}),
    description,
    alternates: { canonical: pageUrl(opts.path) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: fullTitle,
      description,
      url: pageUrl(opts.path),
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [OG_IMAGE.url] },
  };
}

/** schema.org description of the tool on a page. Only facts that are true of the product. */
export function webApplicationJsonLd(opts: { path: string; name: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: opts.name,
    url: pageUrl(opts.path),
    description: opts.description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any modern web browser",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: pageUrl("/") },
  };
}
