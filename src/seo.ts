import type { Metadata } from "next";
import { DESCRIPTION, pageUrl, SITE_NAME, SITE_ORIGIN, TAGLINE } from "@/site";

/**
 * Next.js replaces (not merges) `openGraph` and `twitter` when a page sets them, so every page
 * builds its full set here. That keeps og:title, og:url and the canonical link consistent per page
 * instead of inheriting the home page's.
 */
const OG_IMAGE = { url: "/brand/og.png", width: 1200, height: 630, alt: `${SITE_NAME} — ${TAGLINE}` };

export function pageMetadata(opts: { path: string; title?: string; description?: string; type?: "website" | "article" }): Metadata {
  const description = opts.description ?? DESCRIPTION;
  const fullTitle = opts.title ? `${opts.title} | ${SITE_NAME}` : `${SITE_NAME} — ${TAGLINE}`;
  return {
    ...(opts.title ? { title: opts.title } : {}),
    description,
    alternates: { canonical: pageUrl(opts.path) },
    openGraph: {
      type: opts.type ?? "website",
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

/**
 * A guide, described the way schema.org describes an article. The author and publisher are the
 * product itself: guides are written for the site, and no person is named because none is claimed.
 */
export function guideJsonLd(g: { title: string; description: string; slug: string; date: string; updated: string }) {
  const url = pageUrl(`guides/${g.slug}`);
  const org = { "@type": "Organization", name: SITE_NAME, url: pageUrl("/") };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: g.title,
        description: g.description,
        url,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        datePublished: g.date,
        dateModified: g.updated,
        image: `${SITE_ORIGIN}${OG_IMAGE.url}`,
        author: org,
        publisher: org,
        inLanguage: "en",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: pageUrl("/") },
          { "@type": "ListItem", position: 2, name: "Guides", item: pageUrl("guides") },
          { "@type": "ListItem", position: 3, name: g.title, item: url },
        ],
      },
    ],
  };
}

export function guidesIndexJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Guides | ${SITE_NAME}`,
    url: pageUrl("guides"),
    description,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: pageUrl("/") },
  };
}
