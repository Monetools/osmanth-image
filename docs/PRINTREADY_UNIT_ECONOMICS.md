# Osmanth Image — Unit Economics

Updated 2026-09-21, after AI enlargement was removed from scope.

Osmanth Image has **no server-side processing**. Every feature — inspection, preflight, cropping,
resizing, colour conversion, encoding, verification, Etsy packs — runs in the visitor's browser. The
marginal cost of a user is the cost of serving static files.

| Operation | Where it runs | Server CPU | Bandwidth | Storage | Marginal cost |
|---|---|---|---|---|---|
| Page load (static HTML + JS) | CDN | 0 | JS bundle once, cacheable | 0 | ≈ $0 (CDN egress only) |
| Inspection, preflight, report, crop preview | browser | 0 | 0 (image never uploaded) | 0 | **$0** |
| Crop / resize / flatten / encode / DPI tag / verify | browser | 0 | 0 | 0 | **$0** |
| Etsy pack (6 files + ZIP) | browser | 0 | 0 | 0 | **$0** |

Measured client-side time on the dev machine (Chrome on Windows 10, 12 cores, 2026-09-20):

| Job | Output | Time |
|---|---|---|
| 4000×3000 JPEG → 8×10 crop at 300 PPI + verify | 3000×2400 JPEG, 198 KB (synthetic gradient; real photos are larger) | < 3 s (UI wait window; not instrumented) |
| 4800×7200 JPEG → Etsy pack (6 ratios), each verified, ZIP | 6 files, 3.2 MB ZIP (synthetic) | **9.3 s** (instrumented) |

Synthetic test images compress far better than photos; the file sizes above are not representative of
real uploads.

The cost that does exist is human: keeping printer requirements verified (see
[PROFILE_TRUST_INVENTORY.md](PROFILE_TRUST_INVENTORY.md)). Platform rules expire 90 days after a person
verifies them.

Retail pricing is not set. With no marginal compute cost, any paid tier would be priced on value, not
on cost.
