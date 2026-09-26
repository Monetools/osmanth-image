import type { NextConfig } from "next";

/**
 * Osmanth Image is entirely client-side, so it ships as static files (`out/`) that any static host
 * can serve. Response headers therefore live in `public/_headers` (Cloudflare Pages / Netlify
 * format), not here — Next's `headers()` does nothing under `output: "export"`.
 *
 * `trailingSlash` makes every page `/name/index.html`, which resolves the same way on every static
 * host and matches the canonical URLs and sitemap.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
