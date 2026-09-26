# Osmanth Image — Architecture

Status: MVP (Upload → Select Print Target → Accurate Preflight → Fix Plan → Local fix → Verified download).

Scope decisions (2026-09-21):
* **Images only.** Osmanth Image checks and prepares JPEG / PNG / WebP. PDFs belong to the sibling product,
  [Check Before Submit](https://checkbeforesubmit.com/); a PDF upload is answered with a link there.
* **No AI enlargement.** The AI enhancement layer, its server API, credit ledger and GPU benchmark were
  removed. When an image has too few pixels, the only answer is the honest one: print smaller, or use
  a larger original.
* **No server.** Every feature runs in the browser; the site can be deployed as static files.

## 1. The four durable layers

```
                ┌───────────────────────────── browser (free, private) ─────────────────────────────┐
 File ─bytes──► │ Inspect (headers only) ─► Preflight ◄── Print Profile Engine (JSON data + schema)  │
                │                              │                                                     │
                │                              ▼                                                     │
                │                         Fix Planner ──► RenderSpec ──► Canvas renderer             │
                │                                                               │ bytes               │
                │                                                               ▼                    │
                │                                                 Verification Engine ──► Download │
                └─────────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Code | Runs | Notes |
|---|---|---|---|
| Print Profile Engine | `src/engine/profiles/` (`schema.ts`, `registry.ts`, `data/*.json`) | both | Data only. Validated at load and in tests. See `PRINT_PROFILE_SCHEMA.md`. |
| Preflight Engine | `src/engine/inspect/`, `src/engine/preflight/` | both | Pure TypeScript, no DOM. Deterministic tests in `tests/`. |
| Fix Decision / Execution | `src/engine/fix/planner.ts` (decision), `src/browser/render.ts` (execution) | planner: both; render: browser | Planner emits a `RenderSpec`; it never invents pixels. |
| Verification Engine | `src/engine/verify/verify.ts` | both | Re-inspects the **actual output bytes**; the only code allowed to produce the “Ready” label. |

Everything under `src/engine/` is framework-free and can be reused by a CLI or a future mobile app unchanged.

## 2. Key decisions

### 2.1 Stack
* **Next.js 16 (App Router) + TypeScript**: static SEO entrances (SSG); there are no server routes. All 13 SEO slugs are generated from `src/engine/intents.ts` into a single `[slug]` route that renders the same `<Workflow>` with a preselected intent — no per-page tools (spec §21, red line 19).
* **fflate** (MIT, ~8 KB) for zlib (PNG iCCP) and ZIP packaging. No other runtime dependency.
* No image library in the browser: header parsing is ~500 lines of bounds-checked TypeScript (`src/engine/inspect/`), so inspection costs zero bytes of download and zero server calls.

### 2.2 Browser-local by default (spec §11, §19)
| Operation | Where | Why |
|---|---|---|
| Inspection (dims, EXIF orientation, DPI tags, ICC, alpha channel, JPEG quality estimate, CMYK) | browser, from bytes | privacy, $0, instant |
| Transparency use (does any pixel have alpha < 255?) | browser, canvas scan ≤2048 px | header alone can't tell |
| Crop / resize (stepped ≤2× for anti-aliasing) / flatten / JPEG-PNG encode / DPI tag / size-limit re-encode | browser canvas | “cheap fixes” (§7.1) |
| Colour conversion to sRGB | browser (`createImageBitmap` colour management) | see 2.4 |
| Etsy pack render + ZIP | browser | files never leave the device |

Measured on the dev machine (Chrome, Windows, 12-core CPU): a 4800×7200 artwork → 6 Etsy ratio files rendered, re-verified and zipped in **9.3 s**, entirely client-side.

Known browser limits: iOS Safari caps canvas area (≈16.7 MP historically); very large outputs (e.g. 24×36 in at 300 PPI = 77.8 MP) will fail there. The renderer throws a plain-language `RenderError` and suggests a smaller print size or a desktop browser. The photo/poster profiles prepare 18×24/24×36 at 200/150 PPI (viewing distance), which keeps those outputs ≤ 19.4 MP. Printful/Printify posters and the Etsy 2:3 file are prepared at 300 PPI and can reach 77.8 MP when the source is that large — these jobs may fail on phones and should be run on a desktop browser.

### 2.3 Resolution is pixels ÷ inches (spec §4.1)
`effectivePpiFor(pixels, inches)` is the only resolution source. Embedded DPI is reported as a metadata note that explicitly says it “doesn't change quality”, and a unit test asserts 72-DPI and 300-DPI files with identical pixels produce identical verdicts. The planner writes a DPI tag equal to `canvas pixels / physical inches` so the file opens at the right size — the step label says “does not change quality”.

### 2.4 Colour
* Destination profiles declare `color.expected = "sRGB"` and `cmyk_accepted`.
* The sRGB decision is made from the ICC **colorants** (rXYZ/gXYZ/bXYZ vs. sRGB primaries, ±0.01), not
  the profile name: a renamed sRGB profile passes, and a profile that merely claims "sRGB IEC61966-2.1"
  while carrying wide-gamut primaries is reported as mislabelled and converted properly. Names are only
  a fallback when a profile has no colorants.
* CMYK/YCCK JPEGs and wide-gamut ICC (Adobe RGB, Display P3, ProPhoto) are converted by the browser's colour-managed decode into an sRGB canvas. Outputs are untagged/sRGB. Final status becomes “Technically compatible — Visual review recommended” whenever conversion happened.
* We never convert to CMYK (red line 16). Printify profiles accept CMYK JPEG input as documented; no conversion is forced there.
* Upgrade path when a print-shop profile needs CMYK or exact rendering intents: a server step using **LittleCMS** (`lcms2`, MIT) via `sharp`/libvips `icc_transform`, behind the same `RenderSpec`. No custom CMM.

### 2.4a Source trust, coverage and honest unknowns

Three mechanisms adopted from the sibling CheckBeforeSubmit engine (see `SHARED_CORE_REUSE_ANALYSIS.md`),
implemented here on Osmanth Image's own data model:

* **Verification records** (`profiles/verification.ts`). Every source carries *how* it was verified
  (`human_page_read`, `human_archived_copy`, `vendor_reply`, `internal_policy`, `automated_fetch` or
  `none`), by whom, on what date, with verbatim evidence quotes tied to the fields they support, an
  optional tamper-evident archived copy (path + sha256), and when the check falls due. The validator
  rejects a `current` rule with no verification, and a displayed quote that is not in the evidence.
  `scripts/record-verification.mjs` is how a person records one; it touches trust metadata only and
  never a rule value.
* **Freshness** (`profiles/freshness.ts` over `computeFreshness()`). A stored `review_status` is
  downgraded at read time when the watched source page changed (`needs-review`) or when
  `review_due_at` has passed (`stale`; default 90 days for platform documentation, 365 for our own
  policy; a verifier may choose an earlier date but never one more than a year out). Automation can
  only downgrade — the watch never edits profile data, `--accept` refuses to overwrite a human's
  baseline, and nothing can promote `unverified` to `current` except a person recording a
  verification. A profile's effective trust is the weaker of its quality `source` and its
  `constraints_source`. The engine, the scripts and the tests all call the same pure function.
* **Ambiguity.** Where a platform publishes "20MB" without defining a megabyte, both readings are
  stored and a file between them is reported as *could not verify* — never guessed. Prepared output is
  always kept under the stricter figure.
* **Coverage** (`preflight/coverage.ts`). Every report enumerates what was `checked`,
  `not_applicable`, `could_not_verify` and `not_checked`, each with a reason. Focus/blur is explicitly
  **not checked**, and says why: CheckBeforeSubmit's calibration on 96 real photographs found that
  Laplacian-style sharpness detection missed every soft image, so Osmanth Image does not ship a metric that
  would produce false alarms. Nothing that did not run is ever counted as fine.

### 2.4b Professional checks apply only where the profile asks

`bleed` carries per-side flags (a book interior does not bleed on the bound edge) and
`line_art_ppi_multiplier` raises the resolution bar for 1-bit artwork. Both are opt-in per profile:
destinations that do not trim, and products that do not care about line art, report "Not applicable"
and produce no warnings. This keeps professional print checks from leaking into a photo user's report.

### 2.5 Status model (spec §6)
`READY`, `READY_WITH_WARNINGS`, `FIXABLE`, `REVIEW_RECOMMENDED`, `NOT_RECOMMENDED`, `UNVERIFIED`, computed in `preflight.ts` from issues with a `resolution` of `auto | decision | none`. Too few pixels is always a `decision` (print smaller) and the status is at best `REVIEW_RECOMMENDED` — it is never presented as fixable. Platform profiles that are `review_required` can never be plain `READY`.

### 2.6 Print Quality model (spec §15)
`src/engine/preflight/quality.ts` — three independent, explainable factors:
1. **Technical**: effective PPI vs the profile's `preferred`/`minimum` → `excellent / good / acceptable / low (≤2× short) / very_low (≤4×) / unusable`.
2. **Source**: JPEG quality estimated from the luminance quantisation table (inverse libjpeg scaling, tested ±1). A sharpness hook exists but is **not used in verdicts**: CheckBeforeSubmit's calibration on real photographs showed this kind of metric misses soft images and misreads flat-colour artwork.
3. **Viewing context**: handheld / tabletop / wall / large_wall / apparel — drives per-profile minimums (e.g. 120 PPI is acceptable for 24×36 but low for 4×6).

### 2.7 Verification (spec §16)
`verifyOutput(bytes, …)` re-parses the produced file and checks: pixel dimensions, aspect ratio (≤1 px rounding), format, file size vs destination limit, colour model/profile, transparency (decoded pixel scan for PNG), upright orientation, DPI tag, effective PPI. Only when all hard checks pass may the UI show **“Ready for selected print target”**; if quality factors are uncertain it shows **“Technically compatible — Visual review recommended”**. A verified-but-low-detail file is `REVIEW_RECOMMENDED`. Etsy pack files must all verify before packaging.

## 3. Security (spec §20)

| Control | Where |
|---|---|
| File-signature sniffing; extensions and declared MIME ignored (mismatch reported) | `inspect.ts` `sniffFormat` |
| Decompression-bomb protection: 120 MP / 30 000 px / 80 MB limits checked from **headers before decode** | `security/limits.ts` |
| Bounds-checked parsers (`Reader`), marker/chunk iteration caps, malformed → friendly error | `inspect/bytes.ts`, parsers |
| Truncation detection (JPEG EOI / PNG IEND) and ICC chunk-completeness, reported instead of silently trusted | `inspect/jpeg.ts`, `inspect/png.ts` |
| 200-case fuzz loop asserting inspection never throws | `tests/inspect-structure.test.ts` |
| EXIF parser isolated in try/catch; corrupt EXIF never blocks inspection (tested) | `jpeg.ts`, `png.ts`, `webp.ts` |
| zlib inflate with 4 MB output cap (PNG iCCP) | `png.ts` `inflateCapped` |
| Canvas area cap (100 MP) | `browser/render.ts` |
| Headers: `nosniff`, `X-Frame-Options: DENY`, strict referrer | `next.config.ts` |

## 4. Custom printer specification (spec §18, future)

`buildCustomProfile(options)` already produces a validated temporary `PrintProfile` (size, unit, PPI, output format, max bytes, bleed, safe area) with `source_type: "user_supplied"`. A future “Paste your printer's requirements” parser (LLM or rules) only has to emit `CustomProfileOptions`; preflight, fix, and verification are unchanged. PDF/X output is out of scope: PDFs belong to Check Before Submit.

## 5. Privacy (spec §19)
Local-first, and now local-only: the only network requests are page loads. Images never leave the device, there are no cookies, and nothing is stored.

## 6. Repository map
```
src/engine/        framework-free core (profiles, inspect, preflight, fix, verify, etsy, security, intents)
src/browser/       canvas execution of RenderSpec
src/components/    Workflow (single shared tool), EtsyPack, CropPreview
src/app/           pages ([slug] SEO entrances), sitemap, robots — no API routes
scripts/           source watch, manual verification recorder, trust inventory
tests/             deterministic vitest suites with byte-exact synthetic images
docs/              engineering documents
```
