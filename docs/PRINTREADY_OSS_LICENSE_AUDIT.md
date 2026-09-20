# PrintReady — OSS & Model Licence Audit

Audit date: 2026-09-20. Code licences were read from each repository's LICENSE via the GitHub API (`gh api repos/<repo>/license`); npm licences from installed `package.json`. **This is an engineering audit, not legal advice.** Anything marked UNRESOLVED blocks shipping that component.

Rule (spec §24): a public repository does not make its model weights commercially usable. Code licence and weight licence are audited separately; training-data terms are recorded because weights are derived from them.

## A. Shipped dependencies (in the production app today)

| Project | Repository | Exact version | Code licence | Weights | Commercial use | Redistribution | Attribution | Copyleft | Server-side | Client-side |
|---|---|---|---|---|---|---|---|---|---|---|
| Next.js | github.com/vercel/next.js | 16.3.5 | MIT | n/a | Yes | Yes | Keep notice | None | OK | OK (bundled runtime) |
| React / React DOM | github.com/facebook/react | 19.3.0 | MIT | n/a | Yes | Yes | Keep notice | None | OK | OK |
| fflate | github.com/101arrowz/fflate | 0.8.3 | MIT | n/a | Yes | Yes | Keep notice | None | OK | OK |
| server-only | npm `server-only` | 0.0.1 | MIT | n/a | Yes | Yes | — | None | OK | n/a |

Dev-only (not shipped): TypeScript 7.0.2 (Apache-2.0), Vitest 5.0.1 (MIT), @types/* (MIT).

Note: Next.js pulls `sharp` (Apache-2.0; bundles **libvips under LGPL-3.0**) as an optional dependency for `next/image`. PrintReady does not use `next/image`. If sharp/libvips is adopted for server processing (§10 of the spec), LGPL obligations apply to the libvips binary (dynamic linking + allow replacement) — acceptable for server use; re-check before distributing binaries.

Status: **CLEARED** for all shipped dependencies.

## B. Enhancement / restoration candidates (NOT shipped)

| Project | Repository | Version examined | Code licence (verified) | Weight licence | Training data (from repo docs) | Commercial use | Redistribution | Attribution | Copyleft | Server-side | Client-side | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Real-ESRGAN | github.com/xinntao/Real-ESRGAN | releases v0.1.0–v0.3.0 (weights: RealESRGAN_x4plus, x2plus, realesr-general-x4v3) | BSD-3-Clause | **No separate weight licence stated** in the repo | DF2K (DIV2K + Flickr2K) + OST (docs/Training.md) | Code: yes. Weights: **unclear** | Code: yes with notice | Yes (BSD notice) | None | Code OK | Code OK | **UNRESOLVED (weights)** |
| SwinIR | github.com/JingyunLiang/SwinIR | release v0.0 weights | Apache-2.0 | **No separate weight licence stated** | DIV2K + Flickr2K + OST; SwinIR-L adds WED, FFHQ (2000 faces), Manga109, SCUT-CTW1500 | Code: yes. Weights: **unclear**; SwinIR-L inherits FFHQ non-commercial concerns | Code: yes | Yes (Apache NOTICE) | None | Code OK | Code OK | **UNRESOLVED (weights)**; avoid SwinIR-L |
| GFPGAN | github.com/TencentARC/GFPGAN | master | Apache-2.0 **except third-party components**: StyleGAN2-derived code under the **NVIDIA licence (non-commercial: “research or evaluation purposes only”)** and DFDNet-derived code under **CC BY-NC-SA 4.0** (read from LICENSE) | Not separately stated | FFHQ — per the FFHQ repo, individual images are CC BY / BY-NC / PD, “allow free use … for non-commercial purposes” | **No (as audited)** | Restricted | Yes | NC-SA share-alike on DFDNet parts | Not cleared | Not cleared | **REJECTED for commercial use** |
| CodeFormer | github.com/sczhou/CodeFormer | master | **S-Lab License 1.0 — “for non-commercial purpose”** (read from LICENSE) | Same | FFHQ | **No** | Non-commercial only | Yes | — | Not allowed | Not allowed | **REJECTED** |
| Upscayl | github.com/upscayl/upscayl | main | **AGPL-3.0** | Bundles various third-party models with their own terms | — | Study only | AGPL network clause would apply to our server if code were copied | — | Strong copyleft | Do not copy code | Do not copy code | **Study architecture only; copy nothing** |
| spandrel (model loader) | github.com/chaiNNer-org/spandrel | ≥0.4 (benchmark only) | MIT | n/a (loader) | — | Yes | Yes | Keep notice | None; note `spandrel_extra_arches` contains non-commercial architectures — do not install it | OK | n/a | **CLEARED (core package only)** |
| BasicSR | github.com/XPixelGroup/BasicSR | — | Apache-2.0 | n/a | — | Yes | Yes | NOTICE | None | OK | — | Not needed (spandrel used instead) |

### Open questions blocking Real-ESRGAN / SwinIR weights

1. **DIV2K / Flickr2K / OST terms.** The weights are trained on these datasets. Their terms were **not** read in this audit (dataset sites not fetched). Commonly, research SR datasets are distributed for academic use; whether that restricts *commercial use of models trained on them* is a legal question. → Legal review required.
2. **Weight licence statement.** The Real-ESRGAN and SwinIR repos do not state a licence for the released `.pth` files separately from the code. → Ask authors in writing, or obtain legal opinion that the repository licence covers released weights.
3. **Alternatives if unresolved:** (a) a commercial upscaling API with explicit commercial terms (priced into unit economics); (b) train/fine-tune on commercially licensed data we own; (c) models whose weights carry an explicit permissive licence (to be identified and benchmarked).

## C. Face restoration

Spec §9 allows face restoration only as an optional, conservative, user-controlled stage. Both audited candidates (GFPGAN, CodeFormer) are **not commercially usable as audited**. The code path therefore rejects `face=1` (`benchmark/worker.py`) and the router never requests it. Faces are not modified by PrintReady.

## D. Gate status

| Gate | State |
|---|---|
| Shipped dependencies | ✅ cleared |
| Any AI model weights | ❌ unresolved — `PROVIDER_GATES["realesrgan-selfhosted"].licenseCleared = false` |
| Face restoration | ❌ rejected |

Do not flip `licenseCleared` without updating this document with the evidence.
