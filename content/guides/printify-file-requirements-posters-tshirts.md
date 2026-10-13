---
title: What file does Printify need for posters and t-shirts?
metaTitle: What file does Printify need for posters and t-shirts?
description: Printify's stated file rules, the print areas its editor showed for posters and a t-shirt, and what our check does with them. Each reading is dated.
slug: printify-file-requirements-posters-tshirts
date: 2026-10-13
updated: 2026-10-13
targetQuery: printify file requirements poster t-shirt dpi
toolCta: /printify-image-checker/
ctaText: Check your image for Printify
sources:
  - Printify Help Center: What type of print files does Printify require? | https://help.printify.com/hc/en-us/articles/4483617936657-What-type-of-print-files-does-Printify-require | 2026-10-13
  - Printify Product Creator, Matte Vertical Posters (print area shown for each size) | https://printify.com/app/editor/282/99/digital-printing | 2026-09-27
  - Printify Product Creator, Unisex Heavy Cotton Tee, Gildan 5000 (print area shown for the front, size L) | https://printify.com/app/editor/6/99/dtg | 2026-09-27
---
Printify accepts JPEG, PNG and SVG files and recommends 300 DPI for JPEG and PNG, though a lower resolution may be enough depending on the product. JPEG and PNG files can be up to 100 MB. Exact requirements differ by product and are shown in Printify's product editor, so read the print area there.

## The short version

- **Formats:** JPEG, PNG and SVG.
- **Resolution:** 300 DPI is recommended for JPEG and PNG. A lower resolution "might also be sufficient (depending on the product)." For large products such as leggings, blankets or tapestries, Printify says the required resolution is 120–150 DPI.
- **File size:** up to 100 MB for JPEG and PNG, and up to 20 MB for SVG.
- **Per product:** Printify says the specific file requirements can differ for each product and that you see them for each print area when you open the product in its editor.
- **Low-resolution files:** Printify says it automatically improves the quality of a low-resolution print file before production, and still recommends following each product's requirements and using high-resolution designs.

## What the editor showed

Printify's article points to its product editor for the numbers that matter. On 27 September 2026 we opened the editor for its Matte Vertical Posters and chose each size. We did the same for the front of the Unisex Heavy Cotton Tee (Gildan 5000), size L. The editor states the print area in pixels, and for the tee it also states a DPI of 300.

| Product | Print area in Printify's editor | Pixels at 300 per inch |
|---|---|---|
| Poster 12×18 in | 3,600 × 5,400 px | 3,600 × 5,400 |
| Poster 18×24 in | 5,400 × 7,200 px | 5,400 × 7,200 |
| Poster 24×36 in | 7,200 × 10,800 px | 7,200 × 10,800 |
| Gildan 5000 tee, front, size L | 3,951 × 4,919 px at 300 DPI | about 13.17 × 16.4 in |

For each poster the editor's pixel count is exactly the size in inches × 300. The last column for the tee is the same arithmetic run backwards: 3,951 ÷ 300 and 4,919 ÷ 300. So a poster file made at 300 pixels per inch for the size you order matches what the editor shows. For how pixels relate to print size, see [poster size in pixels](/guides/poster-size-in-pixels/).

## What we tested

We ran test images through the Printify checks in Osmanth Image.

**18×24 in poster.** A 5,400 × 7,200 px image is 300 pixels per inch and comes back "Ready for 18×24 in printing." A 3,600 × 4,800 px image (200 PPI) and a 2,700 × 3,600 px image (150 PPI) both come back "Ready for 18×24 in printing, with notes", with the line "Enough detail at normal viewing distance, but it won't be tack-sharp up close." A 1,800 × 2,400 px image (100 PPI) comes back "Printable at 18×24 in, but the result may disappoint."

**Other posters.** 3,600 × 5,400 px on the 12×18 in check and 7,200 × 10,800 px on the 24×36 in check are each exactly 300 PPI and each ready.

**T-shirt front, size L.** A 3,951 × 4,919 px image on the Gildan 5000 front check is 300 PPI and comes back "Ready for Front print area (size L) 13.17×16.4 in printing, with notes". The note is that our test image has no transparent background, so the whole rectangle would print.

## Limits and what we are unsure of

- Printify does not state a minimum resolution for posters. The 150 PPI floor our check uses for them is our own reading of Printify's 120–150 DPI range for large products, not a Printify rule. The 300 PPI target is Printify's recommendation.
- The editor figures are what we read on 27 September 2026, for one fulfilment option, "Printify Choice". We did not compare print providers.
- The tee reading is for size L only. Printify shows a product size next to its print area, and we did not read other sizes. Printify also has many other t-shirt products with their own print areas.
- Printify's article does not mention colour mode or colour profiles, so we state no rule about them.
- Printify can change its rules at any time. The help article was read on 13 October 2026; read it again before you rely on it.

The check runs on your device and your image is not uploaded; the [privacy page](/privacy/) explains exactly what that means. If you are comparing services, the same questions for Printful are answered in [what file Printful needs for posters and t-shirts](/guides/printful-file-requirements-posters-tshirts/).
