# Osmanth Image production UX audit — 2026-09-29

## Scope

- Production surface: `https://www.osmanthimage.com/`
- Intended user goal: choose an image, select a print destination, understand the print check, prepare and download a verified file.
- Mode: combined UX and accessibility review.
- Evidence: live production first-screen DOM and viewport capture; repository interaction code; automated test, type-check, and production-build results from the same date.

## Overall verdict

The live first impression is clear, credible, and unusually honest about privacy and print limitations. The product is technically healthy in the checks run. The largest remaining experience risk is not visual polish; it is whether a non-technical user notices and understands the newly revealed steps after choosing an image and destination. That part could not be completed in this run because the browser automation file chooser stalled, so the report does not claim the end-to-end production flow passed.

## Flow steps

1. **Land on the homepage — healthy.** The headline explains the outcome in plain language. “Free”, “Stays on your device”, and supported formats answer immediate trust questions. The PDF escape hatch is visible without distracting from the image workflow.
2. **Choose an image — visually healthy; production interaction not fully verified.** The drop area is prominent, names formats, and repeats the local-processing promise. It is keyboard reachable in code. The automated file chooser stalled before the selected-file state could be accepted as evidence.
3. **Choose a print destination — healthy structure; dynamic behavior not fully verified.** Five destinations use concise labels and hints. In code, the controls correctly expose pressed state. Selecting some destinations reveals another selector, but the reveal is not announced and focus remains on the original control.
4. **Review the print check and crop — needs attention; code-supported finding only.** Status, issues, crop preview, and plain-language choices are well separated. Newly inserted Step 3 is not programmatically announced or focused, so keyboard and screen-reader users may not know that the report appeared farther down the page. The crop range communicates direction but not the current crop position as meaningful text.
5. **Prepare, verify, and download — healthy design; production interaction not verified.** The implementation re-opens the generated file and exposes a download only after verification. Busy and error states exist. Completion uses `role="status"`, but focus is not moved to the result, so long pages may leave users unsure where completion appeared.

## Strengths

- Strong trust framing: local processing, no invented pixels, and explicit uncertainty about printer requirements.
- Good task hierarchy: image, destination, check, preparation.
- Useful recovery language: the product recommends a smaller printable size instead of only rejecting low-resolution images.
- Accessible foundations: skip link, visible focus ring, semantic labels, 44 px targets, alert/status regions, and non-colour status icons.
- Engineering gates passed: 155/155 tests, TypeScript type-check, optimized static build, 15-page export check, sitemap, robots, headers, and brand assets.

## UX risks

1. **High: revealed next steps can be missed.** After selecting a destination/profile, Steps 3 and 4 appear below the fold with no scroll, focus move, or short “your report is ready below” announcement. On the narrow production viewport this is especially easy to miss.
2. **Medium: the mobile first screen delays the first action.** The hero, mascot, description, and chips occupy the initial viewport; the upload control is below the fold. The message is good, but returning or task-focused users must scroll before acting.
3. **Medium: “How the check works” is a long dense paragraph.** It is credible copy, but scanning is difficult. Three short bullets—pixels, crop, verification—would preserve trust with less cognitive load.
4. **Medium: custom-size invalid input fails silently.** Entering zero/negative/empty dimensions makes the profile disappear without an inline validation message or guidance.
5. **Low: destination choices look like cards but expose toggle semantics.** Only one destination can be active. Radio-group semantics would better communicate mutual exclusivity to assistive technology.

## Accessibility risks

1. Dynamic insertion of the print report and generated result needs an announcement strategy and ideally focus management.
2. The destination set should use a labelled single-select group (`radiogroup`/`radio`) or equivalent native semantics.
3. The crop slider needs a meaningful current-value description, not only a directional label.
4. Custom width/height fields need inline errors connected with `aria-describedby` and `aria-invalid`.
5. Screenshot evidence alone cannot confirm contrast in every theme, keyboard order through the complete flow, zoom/reflow at 200–400%, or screen-reader output. Those require dedicated verification.

## Recommended order

1. Announce and focus newly available Step 3/4 content after the user's selection and after generation completes.
2. Add explicit validation to custom dimensions.
3. Use single-select semantics for destination and crop-mode choices.
4. Expose crop position as a human-readable value.
5. On mobile, reduce hero vertical space or add a visible “Start with your image” jump action.

## Evidence limits

The live homepage and its narrow-screen first viewport were captured and inspected. The browser automation layer repeatedly stalled while handling the file chooser, so selected-file, report, crop, preparation, and download screens were not accepted as live production evidence. Findings about those states are identified above as code-supported rather than visually confirmed. No claim of full WCAG compliance or full end-to-end production success is made.
