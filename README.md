# Osmanth Image

**Tell us where you're printing. We'll prepare the file.**

Upload an image, choose where it will be printed (photo/poster size, Etsy printable pack, Printful, Printify, or a custom size), get a plain-language preflight, resolve crop decisions, and download a file that has been **re-opened and verified** against the destination's rules. All of this runs in the browser; the image is not uploaded.

## Run

```bash
npm install
npm test          # engine, trust and brand tests
npm run build     # static export to out/, then scripts/check-out.mjs gates it
npm start         # serves out/ at http://localhost:4173 (same as npm run preview)
```

`npm run dev` for development. Node 22.18+ (the scripts import TypeScript directly).

The site is a fully static export (`out/`) — deploy it to any static host. `public/_headers` (Cloudflare Pages format) carries the Content-Security-Policy that makes "the image never leaves your device" browser-enforced (`connect-src 'self'`, `form-action 'none'`). Before launch, see [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).

```bash
npm run watch:sources             # re-check every printer's requirements page; exit 2 = changed
npm run verify:record -- --help   # record a manual verification of a page we cannot fetch
npm run trust:inventory           # regenerate docs/PROFILE_TRUST_INVENTORY.md
```

## What's in the MVP

| Spec item | State |
|---|---|
| Print Profile Engine with source/version/date on every profile | ✅ `src/engine/profiles` (4 groups, 25 profiles) |
| Source trust: freshness, staleness, page-change watch, ambiguity handling | ✅ `profiles/freshness.ts`, `scripts/watch-sources.mjs` |
| Manual verification: method, author, evidence quotes, archived copy + sha256, review-due date | ✅ `profiles/verification.ts`, `scripts/record-verification.mjs` |
| Trust inventory for every profile | ✅ [docs/PROFILE_TRUST_INVENTORY.md](docs/PROFILE_TRUST_INVENTORY.md) |
| Coverage: checked / not applicable / could not verify / not checked | ✅ `preflight/coverage.ts` |
| Per-side bleed and line-art resolution rules, opt-in per profile | ✅ |
| Local inspection (dims, orientation, DPI tag, ICC, alpha, JPEG quality, CMYK) without upload | ✅ `src/engine/inspect` |
| Preflight: effective PPI from pixels, aspect/crop, format, size, transparency, colour, bleed | ✅ `src/engine/preflight` |
| 6-state status model + explainable print-quality model | ✅ |
| Local fixes: crop/fit, resize, flatten, format, compression, DPI tag, sRGB | ✅ `src/browser/render.ts` |
| Final verification of the actual output file | ✅ `src/engine/verify` |
| Etsy printable pack (2:3, 3:4, 4:5, 5:7, 11:14, ISO A) within marketplace limits | ✅ |
| 13 SEO entrances → one shared engine | ✅ `src/engine/intents.ts`, `src/app/[slug]` |

## Documents

* [docs/PRINTREADY_ARCHITECTURE.md](docs/PRINTREADY_ARCHITECTURE.md)
* [docs/PRINT_PROFILE_SCHEMA.md](docs/PRINT_PROFILE_SCHEMA.md)
* [docs/PRINTREADY_OSS_LICENSE_AUDIT.md](docs/PRINTREADY_OSS_LICENSE_AUDIT.md)
* [docs/PRINTREADY_UNIT_ECONOMICS.md](docs/PRINTREADY_UNIT_ECONOMICS.md)

## Scope

* **Images only** (JPEG, PNG, WebP). PDFs are checked by the sibling site, [Check Before Submit](https://checkbeforesubmit.com/); uploading a PDF here links there.
* **No AI enlargement.** Removed on 2026-09-21. Images with too few pixels get an honest answer: the largest size they print well at.
* **No server.** Everything runs in the browser.

The original specification is `PrintReady_Implementation_Spec_v1.0.docx`.
