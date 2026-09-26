/**
 * Coverage: what we actually inspected, what did not apply, and what we could not confirm.
 * (Vocabulary adopted from the sibling CheckBeforeSubmit engine.)
 *
 * The rule this enforces: a check that did not run is never silently counted as "fine".
 *   checked           — we inspected it and the result is in the issue list
 *   not_applicable    — this destination has no such requirement, so there is nothing to report
 *   could_not_verify  — the requirement exists but the file (or the source) does not let us decide
 *   not_checked       — Osmanth Image does not inspect this at all
 */
export type CoverageState = "checked" | "not_applicable" | "could_not_verify" | "not_checked";

export interface CoverageItem {
  id: string;
  label: string;
  state: CoverageState;
  /** Plain-language reason, always present for anything other than `checked`. */
  note: string;
}

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  checked: "Checked",
  not_applicable: "Not applicable",
  could_not_verify: "Could not verify",
  not_checked: "Not checked",
};

export function countCoverage(items: CoverageItem[]): Record<CoverageState, number> {
  const c: Record<CoverageState, number> = { checked: 0, not_applicable: 0, could_not_verify: 0, not_checked: 0 };
  for (const i of items) c[i.state]++;
  return c;
}

/**
 * One line that never claims more than was inspected. `issues` counts only real findings.
 */
export function coverageLine(items: CoverageItem[]): string {
  const c = countCoverage(items);
  const unknown = c.could_not_verify;
  const skipped = c.not_checked;
  const parts = [`${c.checked} checked`];
  if (unknown) parts.push(`${unknown} could not be verified`);
  if (skipped) parts.push(`${skipped} not checked`);
  if (c.not_applicable) parts.push(`${c.not_applicable} not applicable to this destination`);
  return parts.join(" · ");
}
