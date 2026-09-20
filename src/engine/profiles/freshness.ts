import watchFile from "./data/source-watch.json";
import type { ProfileSource, ReviewStatus, SourceType } from "./schema";

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

/** How long a verification stays good, by where the rule came from. */
export const MAX_VERIFICATION_AGE_DAYS: Record<SourceType, number | null> = {
  // Platforms change their requirements without notice.
  official_documentation: 90,
  // Our own quality policy does not expire because someone else edited a page, but it should still
  // be revisited yearly.
  printready_policy: 365,
  industry_convention: 365,
  // A size the user typed in this session.
  user_supplied: null,
};

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

export function daysSince(isoDate: string, now: Date): number {
  return (now.getTime() - new Date(`${isoDate}T00:00:00Z`).getTime()) / 86_400_000;
}

export function watchEntry(url: string, watch: SourceWatchState = sourceWatch): SourceWatchEntry | undefined {
  return watch.sources.find((s) => s.url === url);
}

/** The trust state to act on right now, which may be worse than the stored one. */
export function effectiveFreshness(
  source: ProfileSource,
  watch: SourceWatchState = sourceWatch,
  now: Date = new Date(),
): ReviewStatus {
  if (source.review_status !== "current") return source.review_status;
  const w = watchEntry(source.source_url, watch);
  if (w?.status === "changed-needs-review") return "needs-review";
  const maxAge = MAX_VERIFICATION_AGE_DAYS[source.source_type];
  if (maxAge !== null && daysSince(source.last_verified_at, now) > maxAge) return "stale";
  return "current";
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
  switch (status) {
    case "current":
      return `Checked against ${hostOf(source.source_url)} on ${source.last_verified_at}.`;
    case "stale":
      return `These requirements were last confirmed on ${source.last_verified_at}. Printers change their rules, so check ${hostOf(source.source_url)} before ordering.`;
    case "needs-review":
      return `${hostOf(source.source_url)} has changed since we last confirmed these requirements. Check their current guide before ordering.`;
    case "unverified":
      return `We could not confirm these requirements against ${hostOf(source.source_url)} automatically. Check their current guide before ordering.`;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "the printer's own guide";
  }
}
