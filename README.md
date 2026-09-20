# PrintReady

**Tell us where you're printing. We'll prepare the file.**

Upload an image, choose where it will be printed (photo/poster size, Etsy printable pack, Printful, Printify, or a custom size), get a plain-language preflight, resolve crop decisions, and download a file that has been **re-opened and verified** against the destination's rules. All of this runs in the browser; the image is not uploaded.

## Run

```bash
npm install
npm test          # deterministic engine tests (114)
npm run build
npm start         # http://localhost:3000
```

`npm run dev` for development. Node 20+.

```bash
npm run watch:sources   # re-check every printer's requirements page; exit 2 = something changed
```

## What's in the MVP

| Spec item | State |
|---|---|
| Print Profile Engine with source/version/date on every profile | ✅ `src/engine/profiles` (4 groups, 25 profiles) |
| Source trust: freshness, staleness, page-change watch, ambiguity handling | ✅ `profiles/freshness.ts`, `scripts/watch-sources.mjs` |
| Coverage: checked / not applicable / could not verify / not checked | ✅ `preflight/coverage.ts` |
| Per-side bleed and line-art resolution rules, opt-in per profile | ✅ |
| Local inspection (dims, orientation, DPI tag, ICC, alpha, JPEG quality, CMYK) without upload | ✅ `src/engine/inspect` |
| Preflight: effective PPI from pixels, aspect/crop, format, size, transparency, colour, bleed | ✅ `src/engine/preflight` |
| 6-state status model + explainable print-quality model | ✅ |
| Local fixes: crop/fit, resize, flatten, format, compression, DPI tag, sRGB | ✅ `src/browser/render.ts` |
| Final verification of the actual output file | ✅ `src/engine/verify` |
| Etsy printable pack (2:3, 3:4, 4:5, 5:7, 11:14, ISO A) within marketplace limits | ✅ |
| 14 SEO entrances → one shared engine | ✅ `src/engine/intents.ts`, `src/app/[slug]` |
| EnhancementProvider abstraction, router, cost/entitlement gate, credits ledger | ✅ built — **AI disabled** |
| Model benchmark | ⏳ harness in `benchmark/`, not run |
| Model-weight licences | ❌ unresolved for Real-ESRGAN/SwinIR; GFPGAN/CodeFormer rejected |

## Documents

* [docs/PRINTREADY_ARCHITECTURE.md](docs/PRINTREADY_ARCHITECTURE.md)
* [docs/PRINT_PROFILE_SCHEMA.md](docs/PRINT_PROFILE_SCHEMA.md)
* [docs/PRINTREADY_MODEL_BENCHMARK.md](docs/PRINTREADY_MODEL_BENCHMARK.md)
* [docs/PRINTREADY_OSS_LICENSE_AUDIT.md](docs/PRINTREADY_OSS_LICENSE_AUDIT.md)
* [docs/PRINTREADY_UNIT_ECONOMICS.md](docs/PRINTREADY_UNIT_ECONOMICS.md)

## Before enabling AI enhancement

1. Confirm the `review_required` platform profiles against their source pages (see schema doc).
2. Run the benchmark (`benchmark/`), record results.
3. Resolve weight licences.
4. Measure costs → set `measured: true` estimates → set prices.
5. Flip `PROVIDER_GATES` in `src/engine/enhance/providers.ts`, configure `PRINTREADY_GPU_WORKER_URL` / `PRINTREADY_GPU_WORKER_TOKEN`, add sign-in + payments.

The original specification is `PrintReady_Implementation_Spec_v1.0.docx`.
