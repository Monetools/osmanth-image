# Shared Core Reuse Analysis — CheckBeforeSubmit ↔ PrintReady

Date: 2026-09-20. Method: read-only audit of the real source of both projects (nothing in CheckBeforeSubmit was modified). PrintReady's 74 tests still pass (re-run after writing this document); CheckBeforeSubmit's working tree is untouched (`git status` clean at 85e2ece). No cross-project refactor has been started.

Repositories audited:
* **CheckBeforeSubmit (CBS)** — `D:\Documents\GitHub\checkbeforesubmit`, live at www.checkbeforesubmit.com. Vite 8 MPA + React 19 + TypeScript, `@cantoo/pdf-lib`. ~5,280 lines of `src`, 94 `it(` call sites plus a separate calibration suite. (Counted statically — several tests are generated in loops over fixture manifests, so the executed count is higher. I did not run CBS's suite: this phase is read-only.) Product question: *“Does my file meet the requirements?”*
* **PrintReady (PR)** — `D:\Documents\GitHub\readyforprint`, MVP built 2026-09-20. Next.js 16 + React 19 + TypeScript, `fflate`. ~3,540 lines of `src` (2,357 in `src/engine`), 74 tests (executed, green). Product question: *“Tell us where you're printing. We'll prepare the file.”*

Verdict in one line: **the two products overlap in roughly 900–1,200 lines of low-level byte/geometry code and in one methodology (source trust), but the overlap is not symmetric — each side is clearly better at different things, and the highest-value transfer today is CBS's trust machinery and ICC correctness into PrintReady, not a package extraction.**

---

## 1. What CheckBeforeSubmit already has

### 1.1 Engine layer (`src/engine/`, DOM-free, dependency-injected pixels)

| Capability | File | What it does |
|---|---|---|
| Format sniffing | `jpeg/sniff.ts` | Magic-byte detection of jpeg/png/webp/gif/bmp/tiff/heic/avif. Extension and browser MIME never trusted. |
| JPEG byte parser | `jpeg/parse.ts` (275 ln) | Marker walk: SOF (dims, precision, components, **frame type** baseline/progressive/arithmetic/lossless, **chroma subsampling**), DQT → **IJG quality estimate**, APP0 JFIF density, APP1 EXIF (orientation, XY resolution, ColorSpace tag 0xA001), APP2 ICC chunk reassembly **with completeness check**, APP14 Adobe transform, EOI presence. Returns `problems[]` instead of throwing. Detects RGB JPEGs via component IDs `82,71,66`. |
| ICC reader | `jpeg/icc.ts` (92 ln) | Header colour space, `desc`/`mluc` description, **rXYZ/gXYZ/bXYZ colorants compared against sRGB primaries (±0.01)**. `isSrgb()` trusts colorants over names. |
| Inspector | `inspect.ts` | Facts object; EXIF-oriented display dims; `colorProfile` verdict of `srgb / not-srgb / untagged-exif-srgb / untagged / unreadable`; `parsedOk` requires dims **and** EOI. Never throws. |
| Platform rule registry | `rules/registry.ts`, `rules/adobe-stock-photo.rules.json` | Rules as JSON data with `ruleId`, `requirement`, **`sourceQuote`**, `sourceUrl`, `sourcePageUpdated`, `lastChecked`, `lastChanged`, `lastVerified`, `reviewStatus`, and a typed `check`. |
| Freshness / trust | `rules/registry.ts` + `scripts/rules/watch-sources.mjs` + `rules/snapshots/*.txt` | `effectiveFreshness()` downgrades a "current" rule to `stale` after **90 days**, or to `needs-review` when the watcher's sha256 of the normalised official page text differs from the hash recorded at human verification. **Automation can only downgrade; it never edits the rule file.** Snapshots of the 6 Adobe source pages are committed. |
| Rule evaluation | `rules/evaluate.ts` | Per-rule outcome `pass / fail / could-not-verify / not-checked`, each with a measured value and an explanation. Models **ambiguity in the platform's own wording** (`ambiguityUpper`: is 45MB decimal or binary? is 4MP 4,000,000 or 4,194,304?) as `could-not-verify` rather than guessing. A damaged file cannot "pass" anything but format/size. |
| Quality metrics | `quality/metrics.ts`, `quality/thresholds.ts` (258+94 ln) | Crété-Roffet blur, exposure percentiles, highlight/shadow clipping (interior vs border-connected), Immerkær noise sigma, JPEG blockiness + IJG quality. |
| **Metric maturity** | `quality/thresholds.ts` | Each metric carries `maturity: demoted / experimental / unsupported` **with the measured evidence**: sharpness disabled ("found 0 of 26 soft images on 96 real photos"), exposure disabled (0 of 8), clipping disabled (3 of 9), noise experimental (recall 0.43, FPR 0.07 on real ISO 6400 pairs). Experimental metrics never change a hard verdict. |
| Near-duplicate detection | `similarity/index.ts` | Fingerprint + pair compare + batch clustering. |
| Pixel utilities | `pixels.ts` (201 ln) | Platform-neutral `Raster`, **exact area-average downscale**, EXIF orientation application for all 8 cases, 16-px-aligned tile selection by edge energy, Rec.709 luma. Same code in browser and tests, so metrics are comparable. |
| Print profiles | `print/profiles.ts` (142 ln) | 4 **process** profiles (general / book(KDP values) / flyer / poster) with `targetPpi`, `fixBelowPpi`, `maxPpi`, `bleedMm` + per-side flags, `fontsMustBeEmbedded`, `encryptionIsFailure`, `flagAnnotations`, **`assumptions[]`** and `sources[]`. Plus `PAPER_SIZES` — 19 finished sizes in mm. |
| Image print maths | `print/image.ts` | `effectivePpi()` → `fillPpi` / `fitPpi` / `cropPercent` / `rotated`; `maxPrintSize()`; `requiredPixels()` with explicit floating-point rounding (`152.4/25.4×300 = 1800.0000000000002`). Metadata DPI is displayed but **never used for a verdict**. |
| Report contracts | `print/types.ts` | 4-state `fix / review / passed / not-inspected`; `PrintFinding` with stable `checkId` + `evidence`; **`CoverageItem[]`** (what was *not* inspected and why); `verdictLine()` that never says "no problems" about checks that did not run. |
| Re-check diff | `print/recheck.ts` | Compares a revised file's report with the previous one → `resolved / stillOpen / introduced`, with a numeric-insensitive key. |
| Resource protection | `print/run.ts` | 300 MB PDF / 150 MB image caps, **45 s worker timeout with terminate**, worker failure degrades to "not inspected" instead of crashing, `sniffKind` from the first 1 KB. |
| Browser layer | `browser/queue.ts`, `analyze.worker.ts`, `pixels.ts` | Batch of up to 500 files through ≤2 Web Workers, per-file failure isolation, cancellation. |
| SEO routing | `ui/pages.ts` + Vite MPA inputs | One engine, many entries; each page declares an `EngineScope` (`hardRules`/`quality`/`similarity`). 14 HTML entry points in `vite.config.ts`. |
| Trust page | `ui/Trust.tsx`, `/trust/` | Live rule registry with freshness and metric maturity shown to users. |
| Tests | `tests/` (94 `it(` sites) | sha256-verified binary fixtures + manifest with per-file expectations, a 200-case fuzz loop asserting the inspector never throws, procedural scene generator (`helpers/scenes.ts`, 13 KB) for quality/similarity, PDF builders (`helpers/pdfs.ts`, 9 KB), plus a **separate calibration suite** run against a real-world labelled corpus, and Playwright e2e + built-site checks. |

### 1.2 PDF capabilities (`src/print/pdf/`, ~1,350 lines)

Three layers: `content.ts` (**hand-written content-stream lexer + interpreter**, no pdf-lib knowledge, decoupled via a `ContentHost` callback interface), `analyze.ts` (object-model walk with `@cantoo/pdf-lib` — a fork chosen because it can decrypt — producing facts only), `checks.ts` (facts + profile → findings). The file header states the contract: *"Nothing here is a verdict — checks.ts turns facts + a print profile into findings."*

Parsed: MediaBox/CropBox/TrimBox/BleedBox/ArtBox with min/max normalisation, **`explicit` flags** that distinguish a box actually set on the page from an inherited one, `UserUnit` applied to every box, `/Rotate`, annotation counts, fonts (Subtype, BaseFont, FontFile/2/3, Type0 descendants, Type3, **subset detection via the `/^[A-Z]{6}\+/` tag**, pages used), colour spaces (Device*, Cal*, **ICCBased classified by `/N`**, Separation with spot names, DeviceN, Indexed with recursion, Lab, Pattern), XObject **and inline** images with per-placement effective PPI, transparency groups, OutputIntent subtype + identifier, encryption, PDF version.

Effective image DPI is the most reusable part: the interpreter tracks the CTM across `q`/`Q`/`cm` and form-XObject `/Matrix`, then computes the placed size as the image of the unit square via column norms — `placedSize(m) = { hypot(m[0],m[1]), hypot(m[2],m[3]) }` — which is rotation-correct (shear-approximate), and `ppi = pixels / (placedPt × userUnit / 72)`. Verdicts use the **minimum** PPI across placements larger than 3 mm, **double the target for line art** (`imageMask || bpc === 1`), and compare the *rounded* value on purpose ("2480 px across 210 mm is 299.95 → 300").

Bleed is genuinely more advanced than anything in PrintReady: per-side margins computed from Trim vs Bleed/Media (outer **clipped to MediaBox** first), a 0.2 mm tolerance, **side-aware requirements with page parity** (`outsideIsRight = page % 2 === 1` for book interiors), and, when no explicit TrimBox exists, an `inferred-ok` / `unknown-trim` path where "unknown" is reported as *not-inspected, never passed*. Severity is driven by the user's declared intent (`bleedIntent: yes → fix`, `no → passed`, `unknown → review`) rather than a built-in assumption. The RGB/CMYK verdict is likewise driven by the declared printer requirement (`cmyk-only → fix`, `rgb-ok → passed`, `unknown → review`) — no built-in "CMYK is correct" bias.

Explicitly absent and declared as not-inspected in coverage: optional content/layers, SMask/ExtGState/overprint, ink coverage (TAC), rich black, safe margins, hairlines, minimum font size, crop marks, text extraction, XMP, and validation of the OutputIntent's embedded ICC profile (only its identifier string is read). No PDF/X or PDF/A conformance check.

Robustness: 300 MB cap, 45 s worker kill, 25 s internal deadline checked every 4096 operators, 5 M operator cap, 2,000-page cap, form nesting depth 12, recursive-XObject guard, operand-stack and string caps, table row caps. Encryption is handled with a three-step ladder (normal → empty password → `ignoreEncryption`, with `canReadContent=false` propagating to *not-inspected* results). Two weaknesses worth recording: the encrypted branch is selected by **matching the error message text** `/encrypt/i` (locale/version-fragile), and there is **no decompressed-size cap** — flate streams are decoded wholesale, so the only backstops against a compression bomb are the time budget and browser OOM. PrintReady's "cap the inflate, check pixel counts from the header before decoding" approach is the better answer here and is the one piece of PDF-side hardening that should flow *from* PrintReady.

Tests: ~40 PDF tests, fixtures **100 % generated at test time** with pdf-lib (`tests/helpers/pdfs.ts`) — nested form XObject + inline image asserting 720 PPI vs 20 PPI, all four bleed outcomes, broken/Type0/Type3 fonts, spot colour with tint transform, both encryption modes, garbage input. No real-world producer PDFs in CI (the `fixtures/_scratch/*.pdf` files are git-ignored and unreferenced); the worker, `run.ts` limits, page-count truncation and shear matrices are untested.

Reusability: `content.ts`, `analyze.ts`, `types.ts` and `cover.ts` are drop-in reusable (DOM-free, Node-API-free, `PdfFacts` is plain serialisable data — it crosses a `postMessage` boundary already). `checks.ts` needs three changes to be portable: inject a `PrintProfile` instead of looking it up by this app's `ProfileId` union, inject the paper-size list, and drop `PrintTool`/`TOOL_OF_SCOPE` (page-routing vocabulary inside the check engine). Its hundreds of hard-coded English sentences — including cross-sells like "For images, use the DPI checker." — and its `ReportTable` display-string building are product copy sitting in the engine layer; they must not travel into a shared package unchanged. `run.ts` is Vite-specific (`new URL("./pdf.worker.ts", import.meta.url)`) and would be rewritten per host.

---

## 2. What PrintReady already has

| Capability | File | What it does |
|---|---|---|
| Format sniffing | `engine/inspect/inspect.ts` | Same 9 formats as CBS **plus** PDF and SVG detection, each with a plain-language "why we can't use this" message (`UNSUPPORTED_MESSAGES`). |
| Bounds-checked reader | `engine/inspect/bytes.ts` | `Reader` class: every read is range-checked and throws `ParseError`; used by every parser. |
| JPEG parser | `engine/inspect/jpeg.ts` | SOF/DQT/APP0/APP1/APP2/APP14 + progressive flag + **identical IJG quality estimator** to CBS. Corrupt EXIF is caught per-segment. |
| PNG parser | `engine/inspect/png.ts` | IHDR (bit depth, colour type, interlace), pHYs, tRNS, sRGB, acTL (APNG), eXIf, **iCCP inflated through a 4 MB streaming cap** (decompression-bomb safe). Alpha-channel and colour-model derivation. |
| WebP parser | `engine/inspect/webp.ts` | RIFF walk: VP8 / VP8L / VP8X (canvas size, alpha & animation flags) / ALPH / ICCP / EXIF. |
| ICC reader | `engine/inspect/icc.ts` | Header colour space + `desc`/`mluc` description → `family` (sRGB / Display P3 / Adobe RGB / ProPhoto / CMYK / Gray / Other) **by description string only**. |
| Security limits | `engine/security/limits.ts` | 80 MB / 120 MP / 30,000 px / min 16 px, checked **from header dimensions before any decode**; canvas area cap 100 MP; server job caps. |
| Destination profiles | `engine/profiles/*` | 25 profiles in 4 groups as **JSON data** + a hand-written validator run at load and in tests: trim size (portrait-normalised, `rotatable`), `ppi.preferred`/`ppi.minimum`, accepted/output formats, transparency rule, colour expectation + `cmyk_accepted`, max file size, bleed, safe area, viewing context, `ratio_family` (Etsy), marketplace constraints, and a `source` block with `source_url` / `source_type` / `last_verified_at` / `profile_version` / `review_required`. |
| Custom profile builder | `engine/profiles/registry.ts` | Builds a validated temporary profile from user input; the future "paste your printer's spec" entry point. |
| Geometry | `engine/preflight/geometry.ts` | Target orientation + bleed → full canvas; **`cropToRatio()` returning an actual crop rectangle with a -1..1 offset and area loss**; `effectivePpiFor()`; `maxPrintSize()`; named loss thresholds. |
| Preflight | `engine/preflight/preflight.ts` (321 ln) | Issue list with `category` × `severity` × **`resolution` (`auto`/`decision`/`ai`/`none`)**, 6-state status model, plain-language titles/details, advanced key-value table, "prints well up to" sizes, `suggestSizes()`. |
| Print-quality model | `engine/preflight/quality.ts` | Four explainable factors (technical tier, source tier, enhancement confidence, viewing context) instead of one number. |
| Fix planner | `engine/fix/planner.ts` | Emits a declarative `RenderSpec` (source rect, canvas, draw rect, background, format, quality, ppi, max bytes, physical inches) + human-readable steps + an AI recommendation. **Never upscales locally.** |
| Metadata writers | `engine/fix/metadata.ts` | Writes JFIF density / PNG `pHYs` (with CRC32), replacing any existing chunk. |
| Output execution | `browser/render.ts` | Stepped ≤2× downscale, flatten, unsharp, encode, size-driven quality/dimension back-off, PPI tag write, output alpha scan. |
| **Verification** | `engine/verify/verify.ts` | Re-opens the produced bytes and checks 8 things (dims, ratio within 1 px, format, size limit, colour, transparency, orientation, PPI tag + effective PPI). Only then may the UI say "Ready for selected print target"; otherwise "Technically compatible — Visual review recommended". |
| Etsy pack | `engine/etsy/pack.ts` | Ratio-family planning, per-size PPI table, substantial-loss decisions, filename sanitising, ZIP bin-packing to marketplace limits. |
| AI gating | `engine/enhance/*`, `server/*` | Provider interface with `benchmarked`/`licenseCleared`/`configured` gates, router, cost gate (refuses anonymous full-res, insufficient credits, **and unmeasured costs**), credit ledger. |
| SEO routing | `engine/intents.ts` + `app/[slug]` | 14 slugs as data → one `<Workflow>`; Next SSG. |
| Tests | `tests/` (74 `it()`) | Byte-exact **synthetic images generated in code** (JPEG with chosen DQT quality/EXIF/ICC/Adobe markers, PNG with chosen colour type/pHYs/compressed iCCP, WebP VP8X), plus profile-schema validation, DPI-metadata invariance, status-model, planner, metadata round-trip, verification, cost gate, router and Etsy packing tests. |

---

## 3. What is duplicated

Measured overlap, not impressions:

| # | Capability | CBS | PR | Same algorithm? | Duplicated lines (approx.) |
|---|---|---|---|---|---|
| D1 | Magic-byte format sniffing | `jpeg/sniff.ts` (23) | `inspect/inspect.ts::sniffFormat` (20) | Yes, byte-for-byte equivalent logic | ~40 |
| D2 | JPEG marker walk + SOF/DQT/APP0/APP1/APP2/APP14 | `jpeg/parse.ts` (275) | `inspect/jpeg.ts` (132) + `inspect/exif.ts` (58) | Yes — **including the identical IJG quality inversion** (`scale = sum×100/stdSum; q = scale≤100 ? (200-scale)/2 : 5000/scale`) | ~350 |
| D3 | ICC header/description parsing | `jpeg/icc.ts` (92) | `inspect/icc.ts` (60) | Partly: same header/tag/`desc`/`mluc` walk; **only CBS compares colorants** | ~90 |
| D4 | EXIF IFD0 (orientation, X/YResolution, ResolutionUnit) | inside `jpeg/parse.ts` | `inspect/exif.ts` | Yes | ~60 |
| D5 | PNG header + pHYs | `print/image.ts::parsePngHeader` (17) | `inspect/png.ts` (98, much wider) | PR is a superset | ~20 |
| D6 | Effective-PPI maths + rotation + crop ratio | `print/image.ts::effectivePpi/maxPrintSize/requiredPixels` (35) | `preflight/geometry.ts` (60) + `units.ts` (50) | Same formulas, different shape (CBS returns fill/fit; PR returns a crop rectangle) | ~90 |
| D7 | mm ↔ inch ↔ px conversions | `print/types.ts` (MM_PER_INCH, pt helpers) | `units.ts` | Yes | ~20 |
| D8 | Paper/print size catalogue | `PAPER_SIZES` (19 sizes, mm) | `photo_poster.json` (11 sizes) + Etsy `ratio_family` sizes | **Real data duplication**: A5/A4/A3/A2/A1, 4×6, 5×7, 8×10, 18×24, 24×36 exist on both sides with independently written numbers | ~40 data lines |
| D9 | PPI thresholds per print class | `targetPpi`/`fixBelowPpi`/`maxPpi` on 4 process profiles | `ppi.preferred`/`ppi.minimum` on 25 destination profiles | Same *concept*, **different values** (CBS poster 150/100 for every poster; PR 18×24 = 200/120, 24×36 = 150/100) | concept-level |
| D10 | "Metadata DPI is not quality" rule | `image.ts` info line + comment | `preflight.ts` `metadata.ppi` issue + a dedicated invariance test | Same product rule, stated twice | concept-level |
| D11 | Source/verification metadata on rules | `PlatformRule` (`sourceQuote`, `lastVerified`, `reviewStatus`, …) + `ProfileSource` (`label`,`url`,`checked`) | `ProfileSource` (`source_url`, `source_type`, `last_verified_at`, `profile_version`, `review_required`) | Same intent, **three incompatible shapes across the two repos** | ~60 |
| D12 | Bleed as a per-side length | `bleedMm` + `bleedSides` + page-parity inside/outside + tolerance + `unknown-trim` | `profile.bleed` (one value, all sides) + `resolveTarget()` adding it to the canvas | Same idea; **CBS is strictly ahead** (asymmetric, parity-aware, intent-driven severity) | concept-level |
| D16 | Line-art resolution rule | `imageMask \|\| bpc === 1` → target PPI **doubled** | absent — a 1-bit logo is judged like a photo | CBS only | concept-level |
| D17 | Resource protection against compressed bombs | **absent on the PDF path** (no decompressed-size cap) | capped inflate + header pixel caps before decode | PR only | ~30 |
| D13 | "Never trust the extension / never silently pass" doctrine | `parsedOk`, `not-inspected`, `could-not-verify`, `verdictLine()` | `UNVERIFIED`, `review_required`, verification checks | Same doctrine, independently implemented | concept-level |
| D14 | One engine behind several SEO entries | `ui/pages.ts` + MPA inputs | `intents.ts` + `[slug]` | Same pattern, **different frameworks — not shareable as code** | concept-level |
| D15 | Web-worker / browser pixel access | `browser/*` (workers, batching) | `browser/render.ts` (main thread, canvas) | Different goals (measure vs. produce) | low |

**Name collision to watch:** both repos export a type called `PrintProfile` with *different meaning* — CBS = a printing **process class** (general/book/flyer/poster), PR = a **destination + finished size**. Any shared package must rename these (`ProcessProfile` vs `DestinationProfile`) or the merge will silently confuse the two.

---

## 4. Which implementation is the better shared base (per capability)

Scored on the seven axes requested. "Winner" = the implementation a shared core should start from; ✚ = what must be merged in from the other side.

| Capability | Correctness | Completeness | Tests | Security | Browser compat | Maintainability | Extensibility | **Base** |
|---|---|---|---|---|---|---|---|---|
| Format sniffing | tie | **PR** (+PDF, +SVG, + user-facing reasons) | tie | tie | tie | tie | tie | **PR** ✚ nothing |
| JPEG parsing | **CBS** (truncation/EOI, ICC completeness, RGB component IDs, no-throw contract) | **CBS** (frame type, subsampling, EXIF ColorSpace) | **CBS** (real-file fixtures + 200-case fuzz) | **PR** (`Reader` bounds-checks every read; CBS uses `b[o]!` and can produce `NaN` on a malformed segment rather than a clean error) | tie | tie | tie | **CBS** ✚ PR's `Reader` |
| ICC / sRGB decision | **CBS** (colorants beat names — a renamed sRGB profile passes, a mislabelled wide-gamut one fails; PR would classify both by description) | **CBS** | **CBS** | tie | tie | tie | tie | **CBS** — PR should adopt this outright |
| EXIF | **CBS** (also reads ExifIFD ColorSpace) | **CBS** | tie | **PR** (isolated, cannot break inspection) | tie | **PR** (separate module) | tie | **PR's module shape + CBS's tag coverage** |
| PNG | **PR** | **PR** (colour type, alpha, interlace, APNG, iCCP, sRGB chunk) | **PR** | **PR** (capped inflate) | tie | **PR** | **PR** | **PR** |
| WebP | **PR** (CBS has none) | **PR** | **PR** | **PR** | tie | **PR** | **PR** | **PR** |
| PDF | **CBS** (PR has none) | **CBS** | **CBS** (~40 tests, all synthetic fixtures; no real-producer PDFs) | **CBS** for containment (caps, deadlines, worker kill, encryption ladder) — but **PR's discipline is needed**: CBS has no decompressed-size cap, and its encrypted-file branch keys off an error-message regex | **CBS** (worker) | engine clean; `checks.ts` carries product copy + page-routing vocabulary | — | **CBS**, with PR-style bomb protection added |
| Effective-PPI maths | tie (identical results) | **PR** (crop rectangle + offset + bleed-aware canvas) | **PR** (explicit A4-at-300 = 2480×3508 test) | n/a | n/a | tie | **PR** | **PR** ✚ CBS's `requiredPixels` float rounding and `fitPpi`/`cropPercent` outputs |
| Profile/destination data model | **PR** (schema validator, portrait normalisation, ratio families, marketplace constraints) | **PR** for destinations; **CBS** for process parameters (asymmetric bleed, font/encryption/annotation policy, `assumptions[]`) | **PR** (validator tests; CBS has none for `profiles.ts`) | n/a | n/a | **PR** (JSON data vs TS constants) | **PR** | **PR's schema, extended with CBS's process fields** |
| Source trust / freshness | **CBS** (90-day staleness + page-hash watch + snapshots + downgrade-only automation + `sourceQuote`) | **CBS** | **CBS** (`rules.test.ts`) | n/a | n/a | **CBS** | **CBS** | **CBS** — PR has the weakest link here and should adopt it |
| Ambiguity handling | **CBS** (`could-not-verify` + `ambiguityUpper`) | **CBS** | **CBS** | n/a | n/a | tie | **CBS** | **CBS** |
| Status / report model | tie (different products) | **CBS** for *coverage of what was not checked*; **PR** for *what to do about it* (`resolution`) | tie | n/a | n/a | tie | tie | **Neither — keep both, borrow `CoverageItem` into PR** |
| Quality heuristics | **CBS** (calibrated on a real labelled corpus; PR has only the DQT estimate and an unused sharpness hook) | **CBS** | **CBS** (dedicated calibration suite) | n/a | n/a | **CBS** | **CBS** | **CBS** |
| Output verification | **PR** (CBS never produces a file, so it has nothing to verify) | **PR** | **PR** | **PR** | n/a | **PR** | **PR** | **PR** |
| Re-check / before-after diff | **CBS** | **CBS** | **CBS** | n/a | n/a | **CBS** | **CBS** | **CBS** — useful to PR for "before vs after fixing" |
| Resource protection | **CBS** for *containment* (worker + hard timeout + terminate + per-file isolation); **PR** for *prevention* (header pixel caps before decode, capped inflate, canvas area cap) | tie | tie | **both, complementary** | **CBS** (worker keeps the UI alive) | tie | tie | **Merge both** |
| Test strategy | tie | **CBS** (real fixtures + fuzz + calibration + e2e) | **CBS** | tie | n/a | **PR** (fixtures generated in code — no binaries in git, every byte explained) | **PR** | **PR's generator for shared vectors, CBS's fuzz + sha256 manifest discipline** |

Two honest counterpoints, since the brief asked me not to assume either side is better:

* CBS's JPEG parser is **more complete and better tested against real files**, but its byte access is unchecked (`bytes[o]!`); a hostile or truncated segment can yield `NaN` dimensions that flow into facts, where PrintReady's `Reader` would raise a clean `ParseError`. Neither is wrong; the shared version needs CBS's coverage **inside** PR's bounds-checked reader.
* PrintReady's destination profiles are better structured, but CBS's `assumptions[]` — a plain-language list of *what we assumed and why* shown to users — is something PrintReady lacks entirely, and it is exactly what makes a print tool trustworthy. PrintReady currently hides that reasoning in code comments and docs.

---

## 5. What should become shared core

Ordered by (value ÷ risk). Names are proposals.

**S1. `trust-core` — source metadata + freshness + source watch (data & tooling, not runtime logic).**
One metadata shape (`sourceUrl`, `sourceQuote`, `sourceType`, `lastChecked`, `lastChanged`, `lastVerified`, `reviewStatus`, `version`), one `effectiveFreshness()` rule, one `watch-sources.mjs` + snapshot convention, used by CBS's rule registry and PrintReady's destination profiles. ~200 lines + a script. This is the single most valuable transfer: PrintReady's Etsy/Printful/Printify profiles are all `review_required: true` with no expiry and no page monitoring, which is precisely the failure mode CBS already solved.

**S2. `image-bytes` — container parsing.**
`sniffFormat`, bounds-checked `Reader`, JPEG (CBS's field coverage inside PR's reader), EXIF, ICC (**CBS's colorant-based sRGB decision**), PNG (PR), WebP (PR). ~1,000 lines, both sides already have tests. This is the genuine code duplication.

**S3. `print-geometry` — units and PPI maths.**
mm/in/pt conversions, `effectivePpi` (fill + fit + crop%), `maxPrintSize`, `requiredPixels` (with CBS's float rounding), `cropToRatio` (PR's rectangle + offset), bleed-aware canvas sizing. ~150 lines, pure functions, trivially testable.

**S4. Paper/finished-size catalogue (data).**
One list of standard sizes in mm with ids (A-series, US, photo, poster, book). CBS's `PAPER_SIZES` and PrintReady's `photo_poster.json` sizes must not keep separate copies of 24×36 in. PrintReady's profiles would reference size ids; CBS's calculators would read the same list.

**S5. `quality-signals` (data first, code later).**
The calibrated thresholds **and the maturity/evidence records**. PrintReady should consume CBS's finding that Laplacian-style sharpness is unreliable rather than re-deriving it. Start by sharing the numbers + evidence strings as data; share `metrics.ts` only if PrintReady actually runs pixel metrics.

**S6. Report primitives (small).**
`CoverageItem` / coverage vocabulary and the "never say no problems about checks that didn't run" phrasing helper. Shared as a tiny types+helpers module; each product keeps its own status enum.

**S7. Rule data that is not code: bleed and line-art semantics.**
CBS's side-aware bleed model (per-side requirement, page parity for book interiors, tolerance, `unknown-trim` = not-inspected) and its line-art rule (1-bit / image-mask artwork needs double the PPI target) are product rules PrintReady lacks. Move them into the profile schema as data (`bleed: {top,bottom,inside,outside}`, `lineArtPpiMultiplier`) rather than re-deriving them. Cheap, and it removes a real correctness gap in PrintReady (today a 1-bit logo is judged like a photo, and bleed is one number on all four sides).

**S8. PDF verification primitives — only when PrintReady needs them.**
PrintReady's spec §18 anticipates "paste your printer's requirements" with PDF/X-1a output. The day PrintReady emits a PDF, CBS's `content.ts` (CTM tracking, `placedSize`, per-placement PPI) and `analyze.ts` (box extraction, font embedding, colour-space census) become the natural **final verification** engine for that output — a produced PDF would be re-opened and checked exactly as PrintReady already re-opens produced JPEGs. This is the strongest long-term argument for a shared core, and the strongest argument for *not* rushing: PrintReady has no PDF output and no PDF tests today.

**S9. Shared conformance vectors (test data).**
Generated-in-code fixtures (PrintReady style) + expected facts, run by both suites. This is what actually prevents divergence, and it is worth doing **before** any code extraction.

---

## 6. What must stay product-specific

| Stays in CheckBeforeSubmit | Stays in PrintReady |
|---|---|
| Adobe Stock rule registry and its `check` kinds | Destination catalogue (Etsy/Printful/Printify/photo sizes) and ratio families |
| Near-duplicate / similarity clustering | Fix planner + `RenderSpec` |
| Batch queue for up to 500 files, CSV/JSON export | Canvas execution, metadata writers, output size back-off |
| The 4-state `fix/review/passed/not-inspected` verdict vocabulary and its wording | The 6-state status model, `resolution` (auto/decision/ai/none), "what will be printed" preview |
| PDF checks tied to submission compliance | Final verification of a produced file, Etsy pack + ZIP packaging |
| `/trust/` page, Adobe-specific copy, CBS brand, MPA build | Enhancement providers, router, cost gate, credits, AI copy, Next build |
| Playwright e2e and built-site checks | SEO intents and Next SSG routing |

Both products keep their own brand, domain, SEO pages, UX and analytics. **No user files or user data are ever shared** — the shared artefacts are code, rules and tests only.

---

## 7. Is extraction worth doing now?

**Split answer: yes for S1, S7 (data) and S9, staged yes for S2–S4, no for the rest.**

The case *for* extracting now: the duplicated byte-level code is real (~1,000 lines), both sides are stable and tested, both use TypeScript 5/7 with `moduleResolution: Bundler`, both test with Vitest 5 in a Node environment, and both engines are already DOM-free — technically this is about as easy as shared extraction ever gets.

The case *against* doing it all now, which is stronger than it looks:

1. **The two repos are separate git repositories with different build systems and deployment models** (CBS: Vite MPA producing a static `dist/`; PrintReady: Next 16 with server routes). A local `file:../shared` dependency works on this machine but breaks any single-repo CI/deploy. A shared package therefore needs a real distribution decision (git-URL dependency, private registry, submodule, or a monorepo move) — that is infrastructure work, not code reuse.
2. **The implementations are not yet behaviour-equivalent.** Extracting while ICC/sRGB decisions differ means the extraction PR would also change behaviour on at least one side, which is exactly how regressions hide.
3. **CBS is live; PrintReady is not.** Any shared-core bug now has an asymmetric blast radius.
4. **The most valuable overlap is not code.** The trust machinery, the ambiguity vocabulary, the maturity evidence and the coverage discipline are the things that make both products honest, and they transfer as data + a script with near-zero regression risk.

### Recommended sequence (safest engineering path)

**Phase 0 — conformance first, no extraction (1 short session).**
Add a `tests/conformance/` suite to *each* repo that runs the same generated vectors (S9) against that repo's own inspector, asserting the same expected facts. Differences are recorded as a table, not "fixed" silently. Deliverable: a known, written list of behavioural differences. Nothing else changes; 74 and 94 tests keep passing.

**Phase 1 — transfer capability into PrintReady, still no shared package (low risk, high value). — DONE 2026-09-20.**

> Completed inside PrintReady only; CheckBeforeSubmit was not touched. Tests went 74 → 114, with one
> pre-existing assertion updated (the custom-profile bleed shape gained per-side flags). See the
> "Phase 1 result" section at the end of this document.
* Port CBS's colorant-based `isSrgb` into PrintReady's `icc.ts` (add tests using the existing fixture generator; keep the `family` output).
* Port `hasEoi` / truncation reporting and ICC-chunk completeness into PrintReady's JPEG parser.
* Adopt the trust metadata + `effectiveFreshness()` + `watch-sources.mjs` for PrintReady's profiles, including a `stale` state in the UI. **Note:** the watcher fetches with plain `fetch`; Etsy, Printful and Printify returned HTTP 403 to automated fetching during this project, so for those sources the watcher will report `fetch-failed` and the profiles must stay `needs-review` until a human snapshots them. This is honest behaviour, not a defect — but do not expect automated freshness for those three.
* Adopt CBS's `assumptions[]` and `CoverageItem` ideas in PrintReady's report.
* Extend PrintReady's profile schema with CBS's rule data (S7): per-side bleed, and a line-art PPI multiplier. Schema + data only; the validator and existing profiles keep working because both fields default to today's behaviour.
After this phase the two implementations agree, and the conformance table from Phase 0 should be empty (or explicitly justified).

**Phase 2 — extract `image-bytes` + `print-geometry` + size catalogue, PrintReady first.**
* Create one repository `print-shared` (or a `packages/` monorepo if both products move into it later) exporting TS sources; both consumers use `moduleResolution: Bundler`, so no build step is strictly required — but ship a `tsc` build + `.d.ts` anyway so CBS's Vite build and Next's `transpilePackages` both have a plain-JS fallback. **Spike this first**: prove `npm run build` + `npm test` pass in both repos with the package linked, before moving any code permanently.
* Pin by git tag. Consume it in **PrintReady only** for one cycle (PrintReady is not live).
* Only then switch CBS, in a PR that changes imports and nothing else.

**Phase 3 — profile model convergence (design work before code).**
Design the two-layer model explicitly: `ProcessProfile` (CBS: how a print shop wants files — bleed sides, font embedding, encryption policy, PPI bands) × `DestinationProfile` (PR: a concrete product/size at a named destination). Only after that design exists should the size catalogue and PPI-band semantics merge. Do **not** merge `targetPpi/fixBelowPpi` with `ppi.preferred/ppi.minimum` before deciding whether poster thresholds are per-size (PR) or per-class (CBS) — today they disagree (CBS: every poster 150/100; PR: 18×24 = 200/120).

**Not recommended now:** sharing PDF code (PrintReady has no PDF feature and no PDF tests — importing ~1,350 lines of PDF logic it cannot exercise is pure liability; revisit immediately if PrintReady starts PDF/X output, where CBS's analyzer becomes the natural output verifier — S8), sharing quality `metrics.ts` (PrintReady runs no pixel metrics), sharing UI/report rendering or any of `checks.ts`'s embedded English copy, or merging the two SEO routers.

### If you decide to defer everything
Deferring is defensible: freeze this document, apply **Phase 1 transfers by hand** (they are small and self-contained), and record in both repos' READMEs that `image-bytes`-level code is *intentionally duplicated with a known sibling implementation*, with a pointer to this file. The cost of that choice is bounded (~1,000 lines drifting), and it keeps a live product untouched.

---

## 8. Risks that would make extraction net-negative

| Risk | Why it bites | Mitigation |
|---|---|---|
| Two repos, two deploy pipelines | `file:` links work locally, fail in CI | Decide distribution before moving code; spike both builds |
| `PrintProfile` name collision with different semantics | Silent type confusion in a shared package | Rename to `ProcessProfile` / `DestinationProfile` at extraction time |
| Behavioural drift baked into the extraction commit | Regression that looks like a refactor | Phase 0 conformance table first; extraction commits must be import-only |
| CBS's calibration suite is slow and needs a real-world corpus | A shared-core change may not be validated before release | Require `npm run calibrate` on CBS before any shared version bump that touches pixels or quality |
| Shared package becomes a dumping ground | The classic "common" module | Hard rule: nothing enters shared core unless **both** products import it today |
| Ownership/versioning overhead for a 2-project org | Slows both products down | Single-maintainer git-tag pinning; no semver ceremony |

---

## 9. How existing tests protect the extraction

**Invariant: PrintReady's 74 tests and CheckBeforeSubmit's 94 tests must pass unchanged at every step. Any change to an existing assertion is a behaviour change and must be justified in the PR, never edited to make a refactor pass.**

1. **Baseline capture.** Record both suites green (PR: `npm test` → 74 passed, verified today; CBS: `ALLOW_NO_ORIGIN=1 npm run verify` → lint + typecheck + tests + build — **not run in this audit**, so capture its real baseline before any change) and CBS's calibration results before touching anything.
2. **Conformance vectors (Phase 0).** Shared, generated-in-code inputs with expected facts, executed by both suites. These are the only tests that may be *added* to both repos before extraction; they are what proves the shared implementation is equivalent to both originals.
3. **Import-only extraction.** In Phase 2 the moved files keep their public API; each repo's existing module re-exports from the shared package. A diff that touches assertions or behaviour is rejected.
4. **Both suites gate the shared package.** The shared repo's CI runs its own unit tests **plus** a checkout of both consumers' suites against the candidate version (they are small: ~1 s for PrintReady, seconds for CBS's fast suite).
5. **Fuzz + fixture integrity travel with the code.** CBS's 200-case "never throws" fuzz loop and its sha256 fixture manifest should be part of the shared package's own suite, so hostile input handling cannot regress silently.
6. **Staged rollout.** PrintReady (not live) consumes the shared package for one cycle; CBS switches only after that, in an import-only PR, with `npm run verify` and one manual pass over `/trust/`.
7. **Rollback.** Git-tag pinning means reverting is a one-line dependency change in one repo.

---

## 10. Immediate recommendation

1. **Do now, no extraction:** Phase 0 conformance vectors, and Phase 1's three PrintReady upgrades (colorant-based sRGB, truncation/EOI reporting, trust + freshness + source watch, plus `assumptions[]`/coverage in the report). All are inside PrintReady, all are additive, all are covered by new tests.
2. **Do next, after a build spike:** extract `image-bytes`, `print-geometry`, and the size catalogue into one pinned shared repo, PrintReady first.
3. **Do not do yet:** merge the profile models, share PDF or quality-metric code, or touch CheckBeforeSubmit at all.
4. **AI benchmark and PyTorch/model downloads remain paused**, as instructed.


---

## 11. Phase 1 result (2026-09-20)

Adopted into PrintReady, without creating a shared package and without modifying CheckBeforeSubmit:

| Capability | Where it landed | Test coverage |
|---|---|---|
| Colorant-based sRGB decision (renamed sRGB passes; mislabelled wide-gamut fails) | `inspect/icc.ts` on PrintReady's bounds-checked `Reader` | 5 tests, incl. a real Chrome-produced JPEG verified in the browser |
| JPEG structure: frame type, chroma subsampling, EXIF ColorSpace, ICC chunk completeness, truncation (EOI) | `inspect/jpeg.ts`, `inspect/exif.ts` | 6 tests + a 200-case fuzz loop |
| PNG truncation (IEND) and 1-bit line-art detection | `inspect/png.ts` | 3 tests |
| Source trust: `review_status`, staleness by source type, page-hash watch, downgrade-only automation | `profiles/freshness.ts`, `scripts/watch-sources.mjs`, `data/source-watch.json` | 7 tests |
| Ambiguous published limits (`20MB` = 20,000,000 or 20×1024²) → "could not verify" | schema + preflight + verify | 4 tests |
| Per-side bleed | `schema.ts`, `preflight/geometry.ts` | 3 tests |
| Line-art PPI multiplier, opt-in per profile | schema + preflight + verify | 5 tests |
| Coverage vocabulary (checked / not applicable / could not verify / not checked) | `preflight/coverage.ts`, shown in the UI | 5 tests |

Deliberately **not** copied from CheckBeforeSubmit: its English report copy, its `fix/review/passed`
status vocabulary, its `PrintTool` page routing, and its quality metrics code (PrintReady runs no pixel
metrics — it consumes the *conclusion* of that calibration by declaring focus "not checked", with the
reason stated to the user).

The two implementations are now behaviourally closer on ICC and JPEG structure, which was the
precondition for Phase 2. Phase 2 (extracting `image-bytes` / `print-geometry` into a pinned shared
repository, PrintReady first) remains **not started**, as agreed.
