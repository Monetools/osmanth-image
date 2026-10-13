---
title: Why does my 300 DPI image still print blurry?
metaTitle: Why does my 300 DPI image still print blurry?
description: The 300 DPI stored in a file is only a label. Pixels divided by inches decides sharpness; here is how to check, with two test files that differ only in the tag.
slug: 300-dpi-image-still-blurry
date: 2026-10-13
updated: 2026-10-13
targetQuery: why is my 300 dpi image blurry when printed
toolCta: /300-dpi-image-checker/
ctaText: Check the real pixels per inch of your image
sources:
  - Printful Help Center: What is DPI, resolution and actual print file size? | https://help.printful.com/hc/en-us/articles/50264010605457-What-is-DPI-resolution-and-actual-print-file-size | 2026-10-13
  - Printful: Enhanced Matte Paper Poster, file guidelines | https://www.printful.com/custom/wall-art/posters/enhanced-matte-paper-poster-in | 2026-10-13
  - Printify Help Center: What type of print files does Printify require? | https://help.printify.com/hc/en-us/articles/4483617936657-What-type-of-print-files-does-Printify-require | 2026-10-13
---
The 300 DPI stored in a file is only a label. What decides sharpness is the number of pixels divided by the inches you print across. A 2,400 × 3,000 px image is 300 pixels per inch at 8×10 in but only 150 at 16×20 in, whatever its label says. Check the pixel count against the print size.

## The short version

- The DPI value inside an image file is metadata. It does not add or remove a single pixel.
- Pixels per inch (PPI) = pixels across ÷ inches across the print. Make the print bigger and the same pixels spread thinner.
- A 72 DPI tag does not make a print soft, and a 300 DPI tag does not make one sharp.
- A soft print usually means too few pixels for the size, a soft or heavily compressed original, or both.
- Printful's help center makes the same point: resolution alone is not enough, because the file's dimensions also have to fit the print.

## The same pixels at four print sizes

One image, 2,400 × 3,000 pixels, printed at four sizes. Only the size changes, so only the pixels per inch change. The last column is the target and the lowest figure the check uses for that size; they are Osmanth Image's own guideline for judging a print, not a printer's rule.

| Print size | Pixels per inch | Target and lowest PPI the check uses | What the check says |
|---|---|---|---|
| 8×10 in | 300 | 300 and 180 | Plenty of detail for this size. |
| 12×15 in | 200 | 300 and 150 | Enough detail at normal viewing distance, but it won't be tack-sharp up close. |
| 16×20 in | 150 | 300 and 150 | Enough detail at normal viewing distance, but it won't be tack-sharp up close. |
| 20×25 in | 120 | 200 and 100 | Enough detail at normal viewing distance, but it won't be tack-sharp up close. |

The figure that matters is the second column, and it moves with the print size. The label inside the file never appears in that calculation.

## What we tested

We built two test JPEG files with the same pixel size, 2,400 × 3,000. One carries a 72 DPI tag and the other a 300 DPI tag. They contain only the file structure the check reads, no picture. We ran both through the check for an 8×10 in print.

Both came out at 300 pixels per inch with the same verdict: "Plenty of detail for this size." The check shows the tag in its details ("Embedded DPI setting: 72 (jfif) — does not affect quality") and, for the 72 DPI file, notes that it will correct the print-size setting in the file it prepares. That correction changes a number stored in the file. It does not change the verdict, because the verdict comes from the pixels.

## What does make a print look soft

1. **Too few pixels for the size.** Printful's help center gives its own example: a 5″ × 5″ image at 100 DPI scaled up to 10″ × 10″ without changing the resolution drops to 50 DPI, "meaning the print will look blurry." Printful asks for files that are at least 150 DPI and sized to match the actual print dimensions.
2. **A soft or heavily compressed original.** More pixels cannot add detail the picture never had. The check estimates how heavily a JPEG was compressed and tells you if it is likely to show blocky patches in print. It does not measure how blurry a picture is, so a soft original can pass the pixel check and still print soft.
3. **A print size the product was never meant for.** Targets differ by product. Printify's help center says 300 DPI is recommended for JPEG and PNG files, that a lower resolution might also be sufficient depending on the product, and that large products such as leggings, blankets or tapestries require 120–150 DPI.

## How to check yours

1. Find the pixel size of the image. Once you choose the file in the check, its width and height in pixels appear in Step 1.
2. Decide the print size in inches.
3. Divide the pixels across by the inches across. If 2,400 pixels span 8 inches, that is 300 pixels per inch.
4. Compare the result with the target for that print size. If it is lower, print smaller, or find a larger original. The check shows how large the image prints well.

Editing the DPI box in an image program does not change any of this. If the program resamples the image, it adds or removes pixels, which changes the file but adds no detail. For the pixel counts of common poster sizes, see [poster size in pixels](/guides/poster-size-in-pixels/).

## Limits and what we are unsure of

- The two test files show that our check does not use the tag. We have not tested other software. Some programs may read the tag to suggest a default print size, so check the size setting wherever you print from.
- The check counts pixels and estimates JPEG compression. It does not measure blur, so a soft original can pass it. The two test files have no picture in them, so they say nothing about how sharp a real photo looks.
- The targets in the table are our guideline. A print service can ask for more. Printful, for example, states at least 300 DPI for its poster product.

The check runs on your device and your image is not uploaded; the [privacy page](/privacy/) explains exactly what that means.
