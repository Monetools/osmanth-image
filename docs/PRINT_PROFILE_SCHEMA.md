# Print Profile Schema

Source of truth: `src/engine/profiles/schema.ts` (types + validator). Data: `src/engine/profiles/data/*.json`. Every profile is validated when the registry loads and in `npm test`; malformed data fails loudly instead of producing wrong advice.

## Hierarchy

```
Destination (ProfileGroup)          photo_poster | etsy_printable | printful | printify | custom
 ├── marketplace_constraints?       file-count / file-size / filename rules of the marketplace (Etsy)
 └── Product / Variant (PrintProfile)
      ├── size {width, height, unit}   finished trim size, stored portrait; rotatable → matches landscape images
      ├── ppi {preferred, minimum}     preferred = preparation density; minimum = acceptable floor
      ├── accepted_formats / output_format
      ├── transparency                 flatten_to_white | allowed | preferred
      ├── color {expected: sRGB, cmyk_accepted}
      ├── max_file_size_bytes          CONSERVATIVE reading of the published limit; null = none
      ├── max_file_size_bytes_upper?   permissive reading, when the platform's wording is ambiguous
      ├── bleed {value, unit, sides}   per-side flags: top / bottom / inside / outside
      ├── safe_area                    null = none
      ├── line_art_ppi_multiplier?     >1 only where 1-bit artwork genuinely needs more resolution
      ├── viewing_context              handheld | tabletop | wall | large_wall | apparel
      ├── special_rules[]              human-readable rules shown/used by the engine
      ├── ratio_family?                (Etsy) every nominal size a single file must serve
      ├── source                       quality rules: source_url, source_type, source_quote?,
      │                                last_verified_at, last_checked?, last_changed?,
      │                                review_status, profile_version, review_required, notes
      └── constraints_source?          delivery rules (file size, formats) when they come from a
                                       different place than the quality rules
```

Aspect ratio is derived from `size` (plus bleed) and is not stored separately, so it can never disagree with the size.

## Field reference

| Field | Type | Rule enforced by validator |
|---|---|---|
| `id` | string | `^[a-z0-9_.-]+$`, unique in group |
| `destination` | enum | must equal the group's destination |
| `size` | `{width,height,unit}` | positive; `width <= height`; unit `in`/`mm` |
| `rotatable` | bool | if true, target rotates to match a landscape image |
| `ppi.preferred / ppi.minimum` | number | both > 0; `minimum <= preferred` |
| `accepted_formats` | FileFormat[] | non-empty; must include `output_format` |
| `transparency` | enum | non-flatten rules require PNG output |
| `max_file_size_bytes` | number \| null | > 0 or null |
| `max_file_size_bytes_upper` | number \| null | ≥ `max_file_size_bytes`; requires a lower bound |
| `line_art_ppi_multiplier` | number | between 1 and 4 |
| `bleed` | BleedSpec \| null | value ≥ 0; all four `sides` flags present; a non-zero value needs at least one side |
| `safe_area` | Length \| null | value ≥ 0 |
| `ratio_family.sizes` | size[] | each portrait, same ratio (±1%), largest == `size` |
| `source.source_url` | https URL | required except `user_supplied` |
| `source.source_type` | enum | `official_documentation`, `printready_policy`, `industry_convention`, `user_supplied` |
| `source.last_verified_at` | YYYY-MM-DD | required |
| `source.profile_version` | string | bump on every rule change |
| `source.review_status` | enum | `current` \| `needs-review` \| `stale` \| `unverified` |
| `source.review_required` | bool | must equal `review_status !== "current"` (validator enforces it) |
| `source.last_checked` / `last_changed` | date \| null | written by the source watch, never by hand |
| `source.source_quote` | string? | verbatim sentence from the source; only fill it from the real page |
| `constraints_source` | ProfileSource? | validated exactly like `source` |

## Source-of-truth policy (spec §2)

* `official_documentation` is only used when the value comes from the platform's own help/spec page.
* PrintReady's resolution thresholds for photo/poster sizes are **our policy** (`printready_policy`) — they are never presented as a platform requirement. The UI labels them “PrintReady guideline (not a printer requirement)”.
* A profile with `review_required: true` can never produce a plain `READY` status; the user sees “Double-check the printer's current requirements”.

### Current verification state (2026-09-20)

Trust is now computed, not just stored. `effectiveFreshness()` downgrades a stored `current` when the
watched page changed, or when the last human verification is older than the maximum age for that
source type (90 days for `official_documentation`, 365 for our own policy). Automation can only ever
downgrade; nothing can turn `unverified` into `current` except a human editing the profile.

| Group | Values | review_status | Why |
|---|---|---|---|
| Photo / Poster (11 sizes) | PrintReady policy PPI thresholds | `current` | Our own guideline; the UI labels it "Resolution guideline", never a printer's requirement |
| Etsy ratio profiles — quality | 300 PPI prep / 150 floor | `current` | PrintReady policy |
| Etsy ratio profiles — delivery (`constraints_source`) | 20 MB per file | **`unverified`** | help.etsy.com refuses automated reading (fetch failed 2026-09-20) |
| Etsy marketplace constraints | 5 files, 20 MB, 70-char names | **`unverified`** | same page |
| Printful posters + DTG tee | 150/300 DPI, 200 MB, PNG/JPG, sRGB | **`unverified`** | support.printful.com returned 403 / connection failure |
| Printify posters + tee | 100 MB, PNG RGB, JPEG RGB/CMYK | **`unverified`** | help.printify.com returned 403 |

Source-watch result from the first real run (`npm run watch:sources`, 2026-09-20): **all four sources
`fetch-failed`** — two HTTP 403, two connection failures. The watch records this honestly; it does not
pretend the rules are fresh, and those profiles stay `unverified` until a human reads the pages.

### Ambiguous published limits

Etsy/Printful/Printify publish limits as "20MB" / "200MB" / "100MB" without saying whether a megabyte
is 1,000,000 or 1,048,576 bytes. Each profile stores both readings; files between them are reported as
**could not verify** rather than passed or failed, and prepared output is always kept below the
stricter figure. The UI shows the published figure ("200 MB as published") plus the byte count we
apply, so the number is findable on the platform's own page.

**Action for a human:** open each `source_url`, confirm the values, then set `review_status: "current"`
(and `review_required: false`), update `last_verified_at`, bump `profile_version`, and run
`npm run watch:sources:accept` so the page's current text is recorded as the verified baseline. Paste
the sentence you relied on into `source_quote` while you are there.

## Source watch

`npm run watch:sources` fetches every `source_url` in the profile data, normalises the page text,
hashes it, and compares it with the hash recorded at the last human verification. A change sets
`changed-needs-review` in `data/source-watch.json`; snapshots are written to `profiles/snapshots/` so a
human can diff what actually changed. **The script never edits profile data.** Exit code 2 means at
least one source changed or could not be fetched, so it can gate CI.

## Line art

`line_art_ppi_multiplier` raises the PPI thresholds for 1-bit artwork (detected from the PNG header:
bit depth 1, or a 2-bit palette). It is set only on apparel profiles, where a hard black edge on fabric
needs roughly twice the resolution of a photograph. Every other profile leaves it unset, so photographs
and colour artwork are judged exactly as before and **no unrelated user sees a new warning**.

## Bleed

`bleed.sides` says which edges are actually trimmed. A single-sheet print bleeds on all four; a book
interior does not bleed on the bound edge. Sides that are not trimmed add nothing to the canvas and are
not mentioned in the report. Profiles with no bleed at all report "Not applicable" in coverage.

## Updating profiles without touching image code

1. Edit/add an entry in `src/engine/profiles/data/<group>.json`.
2. Run `npm test` — the schema validator and profile tests must pass.
3. That's it: preflight, fix planning, verification, Etsy packaging and the UI all read the profile.

## Custom / pasted specs

`buildCustomProfile()` (registry.ts) creates a validated temporary profile (`id: custom.user`, `source_type: user_supplied`) from width/height/unit and optional PPI, output format, max size, bleed and safe area. A future spec parser only needs to emit these options.

## Example

```json
{
  "id": "printful.poster.18x24",
  "destination": "printful",
  "product": "Enhanced Matte Paper Poster",
  "variant": "18×24 in",
  "size": { "width": 18, "height": 24, "unit": "in" },
  "rotatable": true,
  "ppi": { "preferred": 300, "minimum": 150 },
  "accepted_formats": ["png", "jpeg"],
  "output_format": "jpeg",
  "transparency": "flatten_to_white",
  "color": { "expected": "sRGB", "cmyk_accepted": false },
  "max_file_size_bytes": 200000000,
  "max_file_size_bytes_upper": 209715200,
  "bleed": null,
  "safe_area": null,
  "viewing_context": "large_wall",
  "special_rules": ["Size the file to the actual print dimensions."],
  "source": {
    "source_url": "https://support.printful.com/hc/en-us/articles/41396495537553-What-type-of-print-files-does-Printful-require",
    "source_type": "official_documentation",
    "last_verified_at": "2026-09-20",
    "last_checked": "2026-09-20",
    "last_changed": null,
    "review_status": "unverified",
    "profile_version": "1.0.0",
    "review_required": true,
    "notes": "…"
  }
}
```
