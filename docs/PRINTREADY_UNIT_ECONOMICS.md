# PrintReady — Unit Economics

**Retail prices: NOT SET.** Per spec §14, prices are chosen only after this table holds measured numbers. AI rows are empty because the benchmark has not run (see `PRINTREADY_MODEL_BENCHMARK.md`). The cost gate enforces this in code: any provider whose estimate is `measured: false` is refused (`reason: "cost_not_measured"`).

## 1. Free tier — marginal server cost

| Operation | Where it runs | Server CPU | Bandwidth | Storage | Marginal cost |
|---|---|---|---|---|---|
| Page load (static SSG HTML + JS) | CDN | 0 | ≈ JS bundle once, cacheable | 0 | ≈ $0 (CDN egress only) |
| Inspection, preflight, report, crop preview | browser | 0 | 0 (image never uploaded) | 0 | **$0** |
| Crop / resize / flatten / encode / DPI tag / verify | browser | 0 | 0 | 0 | **$0** |
| Etsy pack (6 files + ZIP) | browser | 0 | 0 | 0 | **$0** |
| AI quote (`/api/enhance/quote`, JSON with dimensions) | server | < 1 ms | < 1 KB | 0 | ≈ $0 |

Measured client-side time on the dev machine (Chrome on Windows 10, 12 cores, 2026-09-20):

| Job | Output | Time |
|---|---|---|
| 4000×3000 JPEG → 8×10 crop at 300 PPI + verify | 3000×2400 JPEG, 198 KB (synthetic gradient; real photos are larger) | < 3 s (UI wait window; not instrumented) |
| 4800×7200 JPEG → Etsy pack (6 ratios), each verified, ZIP | 6 files, 3.2 MB ZIP (synthetic) | **9.3 s** (instrumented) |

Synthetic test images compress far better than photos; file-size numbers above are not representative of real uploads.

## 2. Paid AI jobs — to be measured

Formula (per job):

```
marginal_cost = gpu_seconds × gpu_$per_second
              + (upload_bytes + download_bytes) × egress_$per_byte
              + temp_storage_bytes × retention × storage_$per_byte_second   (≈0: in-memory only)
              + failure_rate × marginal_cost                                 (retries are not charged to users)
```

Pixel arithmetic below is exact (computed from the profiles); every cost/time column must come from `benchmark/output/results.json`.

| Job | Target | Typical input (assumed) | Scale | Output px | Output MP | Model/provider | GPU/API cost | Time | Bandwidth | Temp storage | Failure rate | Total marginal cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Small photo | 5×7 @300 = 1500×2100 | 750×1050 | 2× | 1500×2100 | 3.15 | — | not measured | — | — | 0 (memory) | — | — |
| 8×10 | 8×10 @300 = 2400×3000 | 1200×1500 | 2× | 2400×3000 | 7.2 | — | not measured | — | — | 0 | — | — |
| A4 | 2480×3508 | 1240×1754 | 2× | 2480×3508 | 8.7 | — | not measured | — | — | 0 | — | — |
| A3 | 3508×4961 | 877×1240 | 4× | 3508×4960 | 17.4 | — | not measured | — | — | 0 | — | — |
| 18×24 poster | 18×24 @200 = 3600×4800 | 900×1200 | 4× | 3600×4800 | 17.3 | — | not measured | — | — | 0 | — | — |
| 24×36 poster | 24×36 @150 = 3600×5400 | 900×1350 | 4× | 3600×5400 | 19.4 | — | not measured | — | — | 0 | — | — |
| Etsy multi-size pack | 2:3 @300 up to 7200×10800 | 1800×2700 | 4× | 7200×10800 | 77.8 | — | not measured | — | — | 0 | — | — |

Notes:
* “Typical input” is an assumption chosen so the scale factor is representative; replace with the median of real (anonymised, aggregate) job sizes once available.
* The Etsy pack only needs **one** enhancement (the largest crop); the other ratios are crops/downsizes of that result, rendered locally for free.
* The 77.8 MP Etsy output exceeds the 25 MP server input cap only on the *output* side; the worker tiles (512 px) so VRAM stays bounded, but output PNG size (~100–200 MB) makes bandwidth a real cost line — measure it.

## 3. Credit model (implemented, prices unset)

* `required_credits = max(1, ceil(estimated_usd / usdPerCredit))`, `usdPerCredit = $0.01` placeholder in `DEFAULT_POLICY`.
* Credits support one-off purchases, grants and refunds (ledger in `src/server/credits.ts`); no subscription is assumed.
* Failures are refunded automatically (`/api/enhance`).
* Free previews: ≤256×256 input, 3 per session — their cost must be measured and reported here too.

## 4. What must happen before choosing prices

1. Run the benchmark on the RTX 3060 (local) and on the intended cloud GPU.
2. Fill section 2 with measured time, VRAM, output size, failure rate.
3. Choose GPU hosting and record its $/hour; compute marginal cost per row.
4. Set `usdPerCredit` and the provider's measured `secondsPerOutputMp`/`usdPerGpuSecond` so `estimate()` returns `measured: true`.
5. Only then choose retail credit packs.
