# Osmanth Image — Open-Source Licence Audit

Updated 2026-09-21. Licences read from each installed package's `package.json`. **This is an
engineering audit, not legal advice.**

## Shipped dependencies

| Project | Repository | Exact version | Licence | Commercial use | Redistribution | Attribution | Copyleft |
|---|---|---|---|---|---|---|---|
| Next.js | github.com/vercel/next.js | 16.3.5 | MIT | Yes | Yes | Keep notice | None |
| React / React DOM | github.com/facebook/react | 19.3.0 | MIT | Yes | Yes | Keep notice | None |
| fflate | github.com/101arrowz/fflate | 0.8.3 | MIT | Yes | Yes | Keep notice | None |

Dev-only (not shipped): TypeScript 7.0.2 (Apache-2.0), Vitest 5.0.1 (MIT), @types/* (MIT).

Next.js pulls `sharp` (Apache-2.0, bundling libvips under LGPL-3.0) as an optional dependency for
`next/image`. Osmanth Image does not use `next/image`, and has no server-side image processing.

Status: **CLEARED** for all shipped dependencies.

## Removed from scope

AI enlargement was dropped on 2026-09-21. The model audit done for it (Real-ESRGAN, SwinIR, GFPGAN,
CodeFormer, Upscayl) is no longer relevant and was removed with the code; it remains in git history
(commit `8cc8555` and earlier) if the question is ever reopened. In short: the model weights' commercial
licensing was unresolved, and GFPGAN / CodeFormer were non-commercial.
