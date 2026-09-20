# PrintReady — Model Benchmark

**Status: harness built, NOT YET RUN.** No model has been benchmarked, so no model is selected and AI enhancement stays disabled (`PROVIDER_GATES.benchmarked = false`). Nothing below is a result; it is the protocol and the empty result tables.

Why not run yet: the benchmark needs PyTorch (CUDA build, ~2–3 GB) and model weights downloaded from GitHub releases, plus a licensed image corpus. Those downloads were not performed without the owner's approval. The target machine has an **NVIDIA RTX 3060 12 GB** (driver 610.88) and Python 3.14; torch wheels may lag Python 3.14, so a Python 3.11/3.12 venv is recommended.

## Protocol (spec §23)

Harness: `benchmark/run_benchmark.py`. Worker used in production later: `benchmark/worker.py` (same `TorchModel` code path, so benchmark numbers transfer).

1. **Corpus** — `benchmark/corpus/manifest.json` defines the 10 required categories: high-quality photograph, smartphone photo, old compressed JPEG, portrait, illustration, digital artwork, typography, logo/graphic, low-resolution internet image, noisy/dark photograph. Use only images with known licences (own photos, CC0). Never customer images.
2. **Models** — `benchmark/models.json`: RealESRGAN_x4plus, RealESRGAN_x2plus, realesr-general-x4v3, SwinIR-M real-world x4 (GAN). Baseline: Lanczos (non-AI). Record SHA-256 of each weight file (the harness does this).
3. **Per image × model × scale (2×, 4×)** the harness records:
   * processing time (CUDA-synchronised, after warm-up), peak VRAM, tiles used, output megapixels
   * round-trip fidelity: original → Lanczos downscale by s → model upscale by s → PSNR/SSIM vs original
   * cost estimate = seconds × `--usd-per-gpu-hour`
   * failures (exceptions are rows, feeding the failure/retry rate)
   * a side-by-side crop PNG (nearest | Lanczos | model) for human review
4. **Human review** (blind, two reviewers) on the side-by-sides, scoring 1–5: visual quality, identity preservation (portraits), text preservation (typography/logo), artefacts (halos, painterly textures, invented detail), sharpness, noise.
5. **Maximum practical output**: largest input that completes within 120 s and 12 GB VRAM at tile 512 fp16.

Decision rules: a model is only “benchmarked” if it beats Lanczos in human review on ≥7/10 categories without identity/text failures; per-category routing is allowed (e.g. no AI for logos/typography — those should be re-exported as vectors).

## Commands

```bash
python -m venv .venv && .venv\Scripts\activate          # Python 3.11/3.12
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r benchmark/requirements.txt
# put weights in benchmark/weights/ (URLs in models.json), images in benchmark/corpus/
python benchmark/run_benchmark.py --fp16 --usd-per-gpu-hour <your GPU $/h>
```

## Results

Environment: _not run_

| Image | Category | Model | Scale | Input | Output MP | Time (s) | Peak VRAM (MB) | PSNR rt | SSIM rt | Visual | Identity | Text | Artefacts | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | — | — | — | not run |

## Decision

**No model selected.** Blocked by: (1) benchmark not run; (2) weight licences unresolved (see `PRINTREADY_OSS_LICENSE_AUDIT.md`). The product works fully without AI: preflight, crop/fit decisions, local fixes, verification and Etsy packs are all AI-free.

## Browser-side inference (spec §11)

Not attempted for SR. Weight sizes from the GitHub release listing: RealESRGAN_x4plus.pth 67.0 MB, RealESRGAN_x2plus.pth 67.1 MB, realesr-general-x4v3.pth **4.9 MB**. A 4× upscale of a 3 MP image produces a 48 MP output whose float tensors alone exceed what mobile browsers can hold, so full-resolution browser inference is ruled out. The 4.9 MB `realesr-general-x4v3` is a realistic candidate for an ONNX Runtime Web + WebGPU **preview crop** (≤256×256) on desktop; to be measured after licences clear. Free previews are still bounded by the cost gate (≤256×256 input) when server-side.
