import type { MetadataRoute } from "next";
import { INTENTS } from "@/engine/intents";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return [{ url: base }, ...INTENTS.map((i) => ({ url: `${base}/${i.slug}` }))];
}
