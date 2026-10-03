import type { MetadataRoute } from "next";
import { INTENTS } from "@/engine/intents";
import { allGuides } from "@/guides/guides";
import { pageUrl } from "@/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: pageUrl("/") },
    ...INTENTS.map((i) => ({ url: pageUrl(i.slug) })),
    { url: pageUrl("guides") },
    // A guide's last-modified date is the one in its own metadata, so it only changes when the guide does.
    ...allGuides().map((g) => ({ url: pageUrl(`guides/${g.slug}`), lastModified: g.updated })),
    { url: pageUrl("privacy") },
  ];
}
