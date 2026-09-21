import watchFile from "./data/source-watch.json";
import type { ProfileSource, ReviewStatus } from "./schema";
import { computeFreshness, isHumanVerified, METHOD_LABEL, reviewDueAt } from "./verification";

export { MAX_VERIFICATION_AGE_DAYS } from "./verification";

/**
 * Trust freshness (approach adopted from the sibling CheckBeforeSubmit engine).
 *
 * Two independent things can make a stored "current" untrue:
 *   1. the source page changed since a human verified it   → needs-review
 *   2. nobody has re-verified it for too long              → stale
 *
 * Automation may only DOWNGRADE trust at read time. The watch script never edits profile data,
 * and nothing here can upgrade `unverified` into `current` — only a human editing the profile can.
 */

export interface SourceWatchEntry {
  url: string;
  /** sha256 of the normalised page text when a human last verified the rules. */
  verifiedHash: string | null;
  /** sha256 seen at the last automated check. */
  lastSeenHash: string | null;
  lastChecked: string | null;
  lastChanged: string | null;
  status: "unchanged" | "changed-needs-review" | "fetch-failed" | "never-checked";
  note?: string;
}

export interface SourceWatchState {
  sources: SourceWatchEntry[];
}

export const sourceWatch: SourceWatchState = watchFile as SourceWatchState;

export function watchEntry(url: string, watch: SourceWatchState = sourceWatch): SourceWatchEntry | undefined {
  return watch.sources.find((s) => s.url === url);
}

/** When this rule must be re-checked. null = it does not expire. */
export function dueDate(source: ProfileSource): string | null {
  return reviewDueAt(source.source_type, source.verification, source.last_verified_at);
}

/**
 * The trust state to act on right now, which may be worse than the stored one.
 *
 * Automation can only ever lower trust here: a changed source page downgrades a `current` rule to
 * `needs-review`, and an overdue re-check downgrades it to `stale`. Nothing in this function can
 * raise trust, and nothing can turn an `unverified` rule into a verified one — only a human
 * recording a verification (see verification.ts) can do that.
 */
export function effectiveFreshness(
  source: ProfileSource,
  watch: SourceWatchState = sourceWatch,
  now: Date = new Date(),
): ReviewStatus {
  return computeFreshness(
    source.review_status,
    source.source_type,
    source.verification,
    source.last_verified_at,
    watchEntry(source.source_url, watch)?.status,
    now,
  );
}

/** Worst (least trusted) state among a profile's quality source and its delivery-constraint source. */
export function profileFreshness(
  source: ProfileSource,
  constraintsSource?: ProfileSource,
  watch: SourceWatchState = sourceWatch,
  now: Date = new Date(),
): ReviewStatus {
  const order: ReviewStatus[] = ["current", "stale", "needs-review", "unverified"];
  const a = effectiveFreshness(source, watch, now);
  if (!constraintsSource) return a;
  const b = effectiveFreshness(constraintsSource, watch, now);
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

export function freshnessMessage(status: ReviewStatus, source: ProfileSource): string {
  const due = dueDate(source);
  switch (status) {
    case "current":
      return source.verification.method === "internal_policy"
        ? `PrintReady guideline, set on ${source.last_verified_at}${due ? ` and due for review by ${due}` : ""}.`
        : `Verified ${METHOD_LABEL[source.verification.method]} on ${source.last_verified_at}` +
          `${source.verification.verified_by ? ` by ${source.verification.verified_by}` : ""}` +
          `${due ? `, due for re-check by ${due}` : ""}.`;
    case "stale":
      return `These requirements were last confirmed on ${source.last_verified_at}${due ? ` and were due for re-check by ${due}` : ""}. Printers change their rules, so check ${hostOf(source.source_url)} before ordering.`;
    case "needs-review":
      return `${hostOf(source.source_url)} has changed since we last confirmed these requirements. Check their current guide before ordering.`;
    case "unverified":
      return `We could not confirm these requirements against ${hostOf(source.source_url)} automatically, and nobody has verified them by hand yet. Check their current guide before ordering.`;
  }
}

/** True when a person, not the fetcher, established this rule. */
export function humanVerified(source: ProfileSource): boolean {
  return isHumanVerified(source.verification);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "the printer's own guide";
  }
}
