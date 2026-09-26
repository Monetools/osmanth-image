import type { MetadataRoute } from "next";
import { INTENTS } from "@/engine/intents";
import { pageUrl } from "@/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [pageUrl("/"), ...INTENTS.map((i) => pageUrl(i.slug)), pageUrl("privacy")].map((url) => ({ url }));
}
