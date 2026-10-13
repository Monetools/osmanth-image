---
title: What file does Printful need for posters and t-shirts?
metaTitle: What file does Printful need for posters and t-shirts?
description: Printful's stated file rules for its poster and t-shirt products, the pixels they work out to, and what our check does with them. Each page is dated.
slug: printful-file-requirements-posters-tshirts
date: 2026-10-13
updated: 2026-10-13
targetQuery: printful file requirements poster t-shirt dpi
toolCta: /printful-image-checker/
ctaText: Check your image for Printful
sources:
  - Printful: Enhanced Matte Paper Poster, file guidelines | https://www.printful.com/custom/wall-art/posters/enhanced-matte-paper-poster-in | 2026-10-13
  - Printful: Unisex Staple T-Shirt (Bella + Canvas 3001), file guidelines | https://www.printful.com/custom/mens/t-shirts/unisex-staple-t-shirt-bella-canvas-3001 | 2026-10-13
  - Printful Help Center: What is DPI, resolution and actual print file size? | https://help.printful.com/hc/en-us/articles/50264010605457-What-is-DPI-resolution-and-actual-print-file-size | 2026-10-13
  - Printful Help Center: How should I prepare my print file for the best results? | https://help.printful.com/hc/en-us/articles/50264019148177-How-should-I-prepare-my-print-file-for-the-best-results | 2026-10-13
---
For its Enhanced Matte Paper Poster, from 5×7 to 24×36 in, Printful asks for PNG or JPEG at 300 DPI or more, in sRGB. For its Unisex Staple T-Shirt it asks for at least 150 DPI, with print areas of 11.5 × 13.8 in (front, XS–M), 15 × 18 in (front, L and up) and 12 × 16 in (back).

## The short version

- **Poster:** PNG or JPEG, at least 300 DPI, sRGB. One set of guidelines covers every size from 5×7 in to 24×36 in.
- **T-shirt (DTG, Unisex Staple T-Shirt):** PNG or JPEG, at least 150 DPI, sRGB.
- **T-shirt print areas:** front 11.5 × 13.8 in for sizes XS–M, front 15 × 18 in from size L, back 12 × 16 in for all sizes.
- **Any design file in the File library:** up to 200 MB and up to 20,000 × 20,000 px. A file name with two dots before the extension, such as "filename..png", makes the upload fail.
- **Per product:** Printful says each product's File guidelines list its own requirements, so check the product you are selling.

## What that means in pixels

Printful states resolution in DPI and sizes in inches. It does not print a pixel count. The pixels below are our arithmetic: inches × the DPI Printful states.

| Product and print area | Printful's stated minimum | Pixels needed at that minimum |
|---|---|---|
| Poster 12×18 in | 300 DPI | 3,600 × 5,400 |
| Poster 18×24 in | 300 DPI | 5,400 × 7,200 |
| Poster 24×36 in | 300 DPI | 7,200 × 10,800 |
| T-shirt front, XS–M, 11.5 × 13.8 in | 150 DPI | 1,725 × 2,070 |
| T-shirt front, L and up, 15 × 18 in | 150 DPI | 2,250 × 2,700 |
| T-shirt back, all sizes, 12 × 16 in | 150 DPI | 1,800 × 2,400 |

The poster number is the demanding one. Printful's help center explains the idea behind it: it asks for files that are sized to match the actual print dimensions, because resolution alone is not enough. For how DPI relates to pixels, see [why a 300 DPI image can still print blurry](/guides/300-dpi-image-still-blurry/).

## What we tested

We ran test images through the Printful checks in Osmanth Image. Each check uses the figures above, which our records mark as read from Printful's own pages.

**Posters.** A 3,600 × 5,400 px image on the 12×18 in poster check is exactly 300 pixels per inch and the check says "Ready for 12×18 in printing." The same poster with a 2,700 × 4,050 px image (225 PPI) comes back "Printable at 12×18 in, but the result may disappoint," with the line "Not quite enough detail for this size — it may look soft or pixelated." A 1,800 × 2,700 px image (150 PPI) gets the same answer. On the 24×36 in poster, 7,200 × 10,800 px is ready and 3,600 × 5,400 px (150 PPI) may disappoint.

**T-shirts.** A 1,725 × 2,070 px image on the XS–M front check is 150 pixels per inch and comes back "Ready for Front print area (XS–M) 11.5×13.8 in printing, with notes." The note is that our test image has no transparent background, so the whole rectangle would print as a solid block. A 1,200 × 1,440 px image (104 PPI) on the same check may disappoint.

**Upload limit.** An image 20,001 pixels wide is flagged "Image is too large to upload", and the check says it will resize the file to the print size.

## Limits and what we are unsure of

- We read one t-shirt product, the Unisex Staple T-Shirt (Bella + Canvas 3001, DTG). Printful's other products, and its other printing methods, have their own guidelines that we have not read.
- The poster page gives a size range, 5×7 in to 24×36 in, not a separate rule for each size. We apply 300 DPI to the three sizes our check covers.
- The pixel counts are our arithmetic. The verdict wording ("may disappoint", "ready") is ours, not Printful's.
- Printful can change its rules at any time. Each page above was read on the date shown; read it again before you rely on it.
- The check does not know which garment size your customer buys. You choose the front print area that matches it.

Printful's poster rule is stricter than our own guideline for large prints. If you are choosing sizes for your own printing instead, see [poster size in pixels](/guides/poster-size-in-pixels/). The check runs on your device and your image is not uploaded; the [privacy page](/privacy/) explains exactly what that means.
