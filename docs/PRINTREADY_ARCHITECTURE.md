# PrintReady — Architecture

Status: MVP milestone 1 (Upload → Select Print Target → Accurate Preflight → Fix Plan → Local fix → Verified download). AI enhancement is architected, gated and **disabled** until the benchmark and licence gates pass.

## 1. The four durable layers

```
                ┌───────────────────────────── browser (free, private) ─────────────────────────────┐
 File ─bytes──► │ Inspect (headers only) ─► Preflight ◄── Print Profile Engine (JSON data + schema)  │
                │                              │                                                     │
                │                              ▼                                                     │
                │                         Fix Planner ──► RenderSpec ──► Canvas renderer             │
                │                              │  (AI rec.)                     │ bytes               │
                │                              ▼                                ▼                    │
                │                     /api/enhance/quote            Verification Engine ──► Download │
                └──────────────────────────────┼────────────────────────────────────────────────────┘
                                               ▼  (dimensions only)
                              server: Router ─► COST GATE ─► credit reserve ─► Provider (GPU/API)
```

| Layer | Code | Runs | Notes |
|---|---|---|---|
| Print Profile Engine | `src/engine/profiles/` (`schema.ts`, `registry.ts`, `data/*.json`) | both | Data only. Validated at load and in tests. See `PRINT_PROFILE_SCHEMA.md`. |
| Preflight Engine | `src/engine/inspect/`, `src/engine/preflight/` | both | Pure TypeScript, no DOM. Deterministic tests in `tests/`. |
| Fix Decision / Execution | `src/engine/fix/planner.ts` (decision), `src/browser/render.ts` (execution), `src/engine/enhance/` (AI) | planner: both; render: browser; AI: server | Planner emits a `RenderSpec`; it never invents pixels locally. |
| Verification Engine | `src/engine/verify/verify.ts` | both | Re-inspects the **actual output bytes**; the only code allowed to produce the “Ready” label. |

Everything under `src/engine/` is framework-free and can be reused by a server worker, CLI, or a future mobile app unchanged.

## 2. Key decisions

### 2.1 Stack
* **Next.js 16 (App Router) + TypeScript**: one codebase serves static SEO entrances (SSG) and the small server API. All 14 SEO slugs are generated from `src/engine/intents.ts` into a single `[slug]` route that renders the same `<Workflow>` with a preselected intent — no per-page tools (spec §21, red line 19).
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
| AI upscale | server GPU / API, gated | too heavy for mobile browsers (see §5) |

Measured on the dev machine (Chrome, Windows, 12-core CPU): a 4800×7200 artwork → 6 Etsy ratio files rendered, re-verified and zipped in **9.3 s**, entirely client-side.

Known browser limits: iOS Safari caps canvas area (≈16.7 MP historically); very large outputs (e.g. 24×36 in at 300 PPI = 77.8 MP) will fail there. The renderer throws a plain-language `RenderError`; the server path (P1) is the fallback. The photo/poster profiles prepare 18×24/24×36 at 200/150 PPI (viewing distance), which keeps those outputs ≤ 19.4 MP. Printful/Printify posters and the Etsy 2:3 file are prepared at 300 PPI and can reach 77.8 MP when the source is that large — these are the jobs that need the server fallback on phones.

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
implemented here on PrintReady's own data model:

* **Freshness** (`profiles/freshness.ts`). A stored `review_status` is downgraded at read time when the
  watched source page changed (`needs-review`) or when the last human verification is older than the
  maximum age for that source type (`stale`; 90 days for platform documentation, 365 for our own
  policy). Automation can only downgrade — `scripts/watch-sources.mjs` never edits profile data, and
  nothing can promote `unverified` to `current` except a human. A profile's effective trust is the
  weaker of its quality `source` and its `constraints_source`.
* **Ambiguity.** Where a platform publishes "20MB" without defining a megabyte, both readings are
  stored and a file between them is reported as *could not verify* — never guessed. Prepared output is
  always kept under the stricter figure.
* **Coverage** (`preflight/coverage.ts`). Every report enumerates what was `checked`,
  `not_applicable`, `could_not_verify` and `not_checked`, each with a reason. Focus/blur is explicitly
  **not checked**, and says why: CheckBeforeSubmit's calibration on 96 real photographs found that
  Laplacian-style sharpness detection missed every soft image, so PrintReady does not ship a metric that
  would produce false alarms. Nothing that did not run is ever counted as fine.

### 2.4b Professional checks apply only where the profile asks

`bleed` carries per-side flags (a book interior does not bleed on the bound edge) and
`line_art_ppi_multiplier` raises the resolution bar for 1-bit artwork. Both are opt-in per profile:
destinations that do not trim, and products that do not care about line art, report "Not applicable"
and produce no warnings. This keeps professional print checks from leaking into a photo user's report.

### 2.5 Status model (spec §6)
`READY`, `READY_WITH_WARNINGS`, `FIXABLE`, `REVIEW_RECOMMENDED`, `NOT_RECOMMENDED`, `UNVERIFIED`, computed in `preflight.ts` from issues with a `resolution` of `auto | decision | ai | none`. Platform profiles that are `review_required` can never be plain `READY`.

### 2.6 Print Quality model (spec §15)
`src/engine/preflight/quality.ts` — four independent, explainable factors:
1. **Technical**: effective PPI vs the profile's `preferred`/`minimum` → `excellent / good / acceptable / low (≤2× short) / very_low (≤4×) / unusable`.
2. **Source**: JPEG quality estimated from the luminance quantisation table (inverse libjpeg scaling, tested ±1). A sharpness hook exists but is **not used in verdicts** because a Laplacian-variance metric misreads flat-colour illustrations as “blurry”; it will be calibrated on the benchmark corpus first.
3. **Enhancement confidence**: none / high (≤2×) / medium (≤3×) / low (4×).
4. **Viewing context**: handheld / tabletop / wall / large_wall / apparel — drives per-profile minimums (e.g. 120 PPI is acceptable for 24×36 but low for 4×6).

### 2.7 Verification (spec §16)
`verifyOutput(bytes, …)` re-parses the produced file and checks: pixel dimensions, aspect ratio (≤1 px rounding), format, file size vs destination limit, colour model/profile, transparency (decoded pixel scan for PNG), upright orientation, DPI tag, effective PPI. Only when all hard checks pass may the UI show **“Ready for selected print target”**; if quality factors are uncertain it shows **“Technically compatible — Visual review recommended”**. A verified-but-low-detail file is `REVIEW_RECOMMENDED`. Etsy pack files must all verify before packaging.

## 3. AI enhancement architecture (built, disabled)

* `EnhancementProvider` interface (`src/engine/enhance/provider.ts`) — capabilities, `gates()` (benchmarked / licenceCleared / configured), `estimate()` returning `{usd, seconds, measured}`, `run()`.
* `routeEnhancement()` scores usable providers by image kind, cost, measured-ness; providers failing any gate are rejected with a reason.
* `evaluateGate()` (spec §12) returns `estimated_compute_cost`, `required_credits`, `user_entitlement`. Refuses: anonymous full-resolution, insufficient credits, previews larger than 256×256 input, exhausted preview quota, and **any placeholder (unmeasured) cost**.
* `/api/enhance/quote` receives **dimensions only**. `/api/enhance` routes and gates **before reading the body**, validates signature/limits, reserves credits, runs with a timeout, refunds on failure, stores nothing.
* `RealEsrganSelfHosted` provider talks to `benchmark/worker.py`. Its gate flags live in `PROVIDER_GATES` and are `false`; its cost model is a placeholder (`measured:false`). Result today: the router selects nothing, the UI says “AI enlargement isn't switched on yet. Your free check and all basic fixes still work.” (verified in the running app: quote → message; POST /api/enhance → HTTP 503).
* Credits: `CreditStore` interface + in-memory implementation supporting purchases/grants/refunds ledger — no subscription assumption. No sign-in exists yet, so everyone is anonymous.

Enabling AI requires, in order: benchmark results → licence clearance → measured cost → `PROVIDER_GATES` flip → pricing in unit economics → payment integration.

## 4. Security (spec §20)

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
| Server: content-length check, gate before body read, dimension match against quote, 25 MP GPU input cap, 120 s timeout, no disk writes, `no-store` | `app/api/enhance/route.ts` |
| Worker: bearer token, Pillow `MAX_IMAGE_PIXELS`, format allow-list, no request logging | `benchmark/worker.py` |
| Headers: `nosniff`, `X-Frame-Options: DENY`, strict referrer | `next.config.ts` |

## 5. Custom printer specification (spec §18, future)

`buildCustomProfile(options)` already produces a validated temporary `PrintProfile` (size, unit, PPI, output format, max bytes, bleed, safe area) with `source_type: "user_supplied"`. A future “Paste your printer's requirements” parser (LLM or rules) only has to emit `CustomProfileOptions`; preflight, fix, and verification are unchanged. Still missing for that feature: PDF/X output and CMYK conversion (LittleCMS server step).

## 6. Privacy (spec §19)
Local-first. The only network calls in the free flow are page loads; the AI quote sends only dimensions. When server processing is enabled it will be explained before upload, processed in memory, never written to disk, never given a URL, and never used for training. A random session cookie (`pr_sid`, 24 h) exists solely for preview quotas.

## 7. Repository map
```
src/engine/        framework-free core (profiles, inspect, preflight, fix, verify, enhance, etsy, security, intents)
src/browser/       canvas execution of RenderSpec
src/components/    Workflow (single shared tool), EtsyPack, CropPreview
src/app/           pages ([slug] SEO entrances), API routes
src/server/        credits, session, quote logic (server-only)
tests/             deterministic vitest suites with byte-exact synthetic images
benchmark/         model benchmark harness + GPU worker (Python)
docs/              the five required engineering documents
```
