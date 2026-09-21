import type { SourceType } from "./schema";

/**
 * Manual verification records.
 *
 * Some printers' requirement pages cannot be read automatically (Etsy, Printful and Printify all
 * refuse our fetches). Those rules can still be trusted — but only if a human went and read the
 * official source and left an auditable record of what they read, when, how, and when it must be
 * checked again.
 *
 * The rules this file exists to enforce:
 *   1. A rule may only be `current` if somebody (or something) actually verified it.
 *   2. Automation may lower trust, never raise it, and never overwrite a human's record.
 *   3. Every claim of verification carries evidence: the verbatim sentence relied on, and where an
 *      archived copy of the source lives.
 *
 * This module imports nothing but types, so `scripts/*.mjs` can import it directly (Node strips the
 * types) and the expiry rule exists in exactly one place.
 */

export type VerificationMethod =
  /** Never verified. The rule cannot be `current`. */
  | "none"
  /** The source watch fetched and hashed the page itself. */
  | "automated_fetch"
  /** A person opened the official page and read it. */
  | "human_page_read"
  /** A person saved a copy of the official page or spec sheet into the repository. */
  | "human_archived_copy"
  /** A written answer from the vendor (support ticket, email). */
  | "vendor_reply"
  /** Our own policy decision — there is no external source to verify against. */
  | "internal_policy";

export const HUMAN_METHODS: VerificationMethod[] = ["human_page_read", "human_archived_copy", "vendor_reply"];
export const VERIFICATION_METHODS: VerificationMethod[] = ["none", "automated_fetch", ...HUMAN_METHODS, "internal_policy"];

export interface VerificationEvidence {
  /** Verbatim sentence from the source. Never a paraphrase, never a search-engine summary. */
  quote: string;
  /** Which profile fields this sentence supports, e.g. ["max_file_size_bytes"]. */
  supports: string[];
  /** Repo-relative path of the archived copy of the source. */
  archived_copy?: string | null;
  /** sha256 of that archived file, so a silent edit is detectable. */
  archived_sha256?: string | null;
  note?: string;
}

export interface Verification {
  method: VerificationMethod;
  /** ISO date the verification happened. Must equal the source's `last_verified_at`. */
  verified_at: string | null;
  /** Who did it — a person or team name, so the record is auditable. */
  verified_by: string | null;
  /** Explicit expiry. When absent, the default for the source type applies. */
  review_due_at?: string | null;
  evidence: VerificationEvidence[];
}

/** How long a verification stays good, by where the rule came from. */
export const MAX_VERIFICATION_AGE_DAYS: Record<SourceType, number | null> = {
  // Platforms change their requirements without notice.
  official_documentation: 90,
  // Our own policy does not expire because someone else edited a page, but it is revisited yearly.
  printready_policy: 365,
  industry_convention: 365,
  // A size the user typed in this session.
  user_supplied: null,
};

/** Nobody may postpone a re-check further than this, whatever the source type. */
export const MAX_EXPLICIT_REVIEW_DAYS = 365;

const DAY_MS = 86_400_000;

export function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return new Date(parseDate(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - parseDate(fromIso).getTime()) / DAY_MS;
}

/**
 * When this rule must be looked at again. An explicit `review_due_at` wins (a human may know the
 * page is about to change), otherwise the default for the source type applies.
 * null = never expires (user-supplied sizes).
 */
export function reviewDueAt(sourceType: SourceType, verification: Verification | undefined, lastVerifiedAt: string): string | null {
  if (verification?.review_due_at) return verification.review_due_at;
  const maxAge = MAX_VERIFICATION_AGE_DAYS[sourceType];
  if (maxAge === null) return null;
  return addDays(verification?.verified_at ?? lastVerifiedAt, maxAge);
}

export function isOverdue(due: string | null, now: Date): boolean {
  return due !== null && now.getTime() > parseDate(due).getTime();
}

export function isHumanVerified(v: Verification | undefined): boolean {
  return v !== undefined && HUMAN_METHODS.includes(v.method);
}

export const METHOD_LABEL: Record<VerificationMethod, string> = {
  none: "not verified",
  automated_fetch: "read automatically from the source page",
  human_page_read: "read by a person on the official page",
  human_archived_copy: "read by a person from an archived copy kept in this repository",
  vendor_reply: "confirmed in writing by the vendor",
  internal_policy: "our own policy decision, not an external requirement",
};

/** Fields a piece of evidence is allowed to claim support for. */
export const VERIFIABLE_FIELDS = [
  "ppi.preferred",
  "ppi.minimum",
  "size",
  "accepted_formats",
  "output_format",
  "transparency",
  "color.expected",
  "color.cmyk_accepted",
  "max_file_size_bytes",
  "max_file_size_bytes_upper",
  "bleed",
  "safe_area",
  "line_art_ppi_multiplier",
  "special_rules",
  "marketplace.max_files_per_listing",
  "marketplace.max_file_size_bytes",
  "marketplace.filename_max_length",
  "marketplace.filename_allowed",
] as const;

export type VerifiableField = (typeof VERIFIABLE_FIELDS)[number];

/**
 * The trust state to act on, given a stored status and what the watch last saw.
 * Pure and dependency-free so the engine, the scripts and the tests all use the same rule.
 *
 * Automation can only lower trust here: `changed` and an overdue re-check downgrade a `current`
 * rule; nothing in this function can raise one.
 */
export function computeFreshness(
  stored: "current" | "needs-review" | "stale" | "unverified",
  sourceType: SourceType,
  verification: Verification | undefined,
  lastVerifiedAt: string,
  watchStatus: "unchanged" | "changed-needs-review" | "fetch-failed" | "never-checked" | undefined,
  now: Date,
): "current" | "needs-review" | "stale" | "unverified" {
  if (stored !== "current") return stored;
  if (watchStatus === "changed-needs-review") return "needs-review";
  if (isOverdue(reviewDueAt(sourceType, verification, lastVerifiedAt), now)) return "stale";
  return "current";
}

export const UNVERIFIED: Verification = { method: "none", verified_at: null, verified_by: null, evidence: [] };

/**
 * Build the verification record a recording tool writes. Kept here (not in the script) so the
 * engine, the script and the tests agree on exactly one shape.
 */
export function buildVerification(input: {
  method: VerificationMethod;
  verifiedAt: string;
  verifiedBy: string;
  reviewDueAt?: string | null;
  evidence?: VerificationEvidence[];
}): Verification {
  return {
    method: input.method,
    verified_at: input.verifiedAt,
    verified_by: input.verifiedBy,
    review_due_at: input.reviewDueAt ?? null,
    evidence: input.evidence ?? [],
  };
}

/**
 * May an automated fetch claim this source as its own baseline? Never, once a person has verified
 * it: automation is allowed to notice a change (which lowers trust) but not to take ownership of a
 * human's finding.
 */
export function canAutomationClaim(v: Verification | undefined): boolean {
  return !isHumanVerified(v);
}

/**
 * Apply a manual verification to a source record. Only trust metadata changes here — rule VALUES
 * (sizes, limits, formats) are never touched, so recording a verification can never silently alter
 * what we tell users a printer requires.
 */
export function applyManualVerification<T extends {
  source_type: SourceType;
  last_verified_at: string;
  review_status: string;
  review_required: boolean;
  source_quote?: string;
  verification: Verification;
}>(source: T, record: Verification): T {
  if (record.method === "none" || record.method === "automated_fetch") {
    throw new VerificationError("applyManualVerification expects a human or internal-policy record");
  }
  validateVerification("record", source.source_type, record.verified_at ?? "", record);
  const next = { ...source };
  next.verification = JSON.parse(JSON.stringify(record)) as Verification;
  next.last_verified_at = record.verified_at!;
  next.review_status = "current";
  next.review_required = false;
  if (record.evidence[0]?.quote) next.source_quote = record.evidence[0].quote;
  return next;
}

export class VerificationError extends Error {}

/**
 * Validate one verification record. Throws with a plain reason, so bad data fails at load time and
 * in `npm test` rather than turning into a false "current" in the UI.
 */
export function validateVerification(id: string, sourceType: SourceType, lastVerifiedAt: string, v: Verification | undefined): void {
  const fail = (msg: string): never => {
    throw new VerificationError(`Verification for "${id}": ${msg}`);
  };
  if (!v) fail("missing verification record");
  const rec = v!;
  if (!VERIFICATION_METHODS.includes(rec.method)) fail(`unknown method ${rec.method}`);
  if (!Array.isArray(rec.evidence)) fail("evidence must be an array");

  if (rec.method === "none") {
    if (rec.verified_at !== null) fail("method 'none' cannot carry a verification date");
    return;
  }
  if (!rec.verified_at || !/^\d{4}-\d{2}-\d{2}$/.test(rec.verified_at)) fail("verified_at must be YYYY-MM-DD");
  if (rec.verified_at !== lastVerifiedAt) fail(`verified_at (${rec.verified_at}) must equal last_verified_at (${lastVerifiedAt})`);
  if (!rec.verified_by) fail("verified_by is required — a verification must be attributable");

  if (rec.review_due_at) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.review_due_at)) fail("review_due_at must be YYYY-MM-DD");
    const span = daysBetween(rec.verified_at!, parseDate(rec.review_due_at));
    if (span <= 0) fail("review_due_at must be after verified_at");
    if (span > MAX_EXPLICIT_REVIEW_DAYS) fail(`review_due_at may not be more than ${MAX_EXPLICIT_REVIEW_DAYS} days after verification`);
  }

  if (HUMAN_METHODS.includes(rec.method)) {
    if (rec.evidence.length === 0) fail(`method '${rec.method}' requires at least one piece of evidence`);
    for (const e of rec.evidence) {
      if (!e.quote?.trim()) fail("evidence needs a verbatim quote from the source");
      if (!e.supports?.length) fail("evidence must say which fields it supports");
      for (const f of e.supports) {
        if (!(VERIFIABLE_FIELDS as readonly string[]).includes(f)) fail(`evidence supports unknown field "${f}"`);
      }
      if (e.archived_copy && !e.archived_sha256) fail("an archived copy must carry its sha256");
    }
    if (rec.method === "human_archived_copy" && !rec.evidence.some((e) => e.archived_copy)) {
      fail("method 'human_archived_copy' requires an archived file path");
    }
  }
  if (rec.method === "internal_policy" && sourceType === "official_documentation") {
    fail("a platform requirement cannot be verified by internal policy");
  }
}
