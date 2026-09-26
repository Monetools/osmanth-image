# Launch checklist — Osmanth Image

Canonical origin: `https://www.osmanthimage.com` (owner decision, 2026-09-27); the bare `osmanthimage.com` 301s to it. Set at build time with `NEXT_PUBLIC_SITE_URL` if it ever changes.
Status of each line is honest: "done" means verified in this repo; everything else is for a person.

## Done in the repo
- Static export builds; `scripts/check-out.mjs` gates the build (15 pages, sitemap, robots, `_headers`, brand files, banned wording).
- Typecheck, engine/trust/brand tests pass. Trust inventory regenerates cleanly (`npm run trust:check`).
- Brand Asset Kit applied: tokens, logos (used as delivered), reversed logo in dark mode, mascot states, favicons, OG image, footer endorsement "An Osmanth product".
- Text contrast meets 4.5:1 in light and dark; interactive controls are at least 44px.
- Per-page canonical, Open Graph, Twitter, JSON-LD; sitemap and robots on the canonical origin.
- Browser audit (headless Chromium, light/dark/mobile): no console errors, no failed requests, no request leaves the site's own origin, no horizontal overflow.

## Hosting and DNS (needs a person)
- [ ] Deploy `out/` to a static host that honours `_headers` (Cloudflare Pages does). Confirm the CSP header is actually served: `curl -I https://www.osmanthimage.com/`.
- [ ] Redirect `osmanthimage.com` (bare) → `https://www.osmanthimage.com/` with a 301 at the host (Cloudflare Redirect Rule, keep path and query). Both hostnames need DNS records, or the bare one cannot redirect.
- [ ] HTTPS on both hostnames; HSTS once HTTPS is confirmed.
- [ ] Unknown URLs return a real 404 (the host must serve `404.html`).
- [ ] Submit `https://www.osmanthimage.com/sitemap.xml` to Search Console.

## Trust data (needs a person — do not skip)
- [ ] 15 profile records are still `unverified` (`method: none`). Nothing here was fabricated. Someone must open each official page, check it, and record it with `npm run verify:record`. Until then the product says so on the page.
- [ ] Run `npm run watch:sources` before launch; exit code 2 means an official page changed.
- [ ] Do not change any Etsy / Printful / Printify rule value without human-verified official evidence.

## Split with Check Before Submit
- [ ] Only after this site is live: CBS 301s `/dpi-checker/` etc. — see `docs/CBS_HANDOFF_PDF_IMAGE_SPLIT.md`. CBS must not remove its image routes before then.
- [ ] `osmanth.com` did not resolve when checked, so the footer endorsement is plain text, not a link. Link it once the parent site exists.

## Brand Studio items to raise
- Logo SVGs use live `<text>` in a system font; the kit names Inter. Ask whether the text should be outlined.
- `character.json` lists accent `#1f86d6`, which differs from the brand accent token.
- Dark mode: the accent and the READY green are the same hue family — worth a look from Brand Studio (not measured here).

## Owner decisions
- [ ] Contact route and terms of use: the privacy page has no contact address. Add one before launch if wanted.
- [ ] If analytics of any kind is ever added, the privacy page and the CSP must change first.
- [ ] Node ≥ 22.18 is required for the build scripts — set it in the host's build settings.
- Known limitation: the CSP needs `'unsafe-inline'` for scripts and styles because a Next static export inlines them.
- Known limitation: Next 16.3.5's static export mis-places prefetch payloads, so internal links are plain `<a>` instead of `next/link`.
