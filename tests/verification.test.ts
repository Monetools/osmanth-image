import { describe, expect, it } from "vitest";
import {
  addDays,
  applyManualVerification,
  buildVerification,
  canAutomationClaim,
  computeFreshness,
  MAX_EXPLICIT_REVIEW_DAYS,
  reviewDueAt,
  validateVerification,
  VerificationError,
  type Verification,
} from "@/engine/profiles/verification";
import { validateProfile, type PrintProfile, type ProfileSource, ProfileValidationError } from "@/engine/profiles/schema";
import { dueDate, effectiveFreshness, humanVerified, type SourceWatchState } from "@/engine/profiles/freshness";
import { getGroup, requireProfile } from "@/engine/profiles/registry";
import { findSources } from "../scripts/record-verification.mjs";
import { inspectImage } from "@/engine/inspect/inspect";
import { runPreflight } from "@/engine/preflight/preflight";
import { makeJpeg } from "./fixtures";

const NOW = new Date("2026-09-20T12:00:00Z");

const humanRecord = (over: Partial<Verification> = {}): Verification => ({
  method: "human_page_read",
  verified_at: "2026-09-20",
  verified_by: "Jane",
  review_due_at: null,
  evidence: [{ quote: "Files must be at least 300 DPI.", supports: ["ppi.minimum"] }],
  ...over,
});

describe("a verification record must be auditable", () => {
  const ok = (v: Verification, type: ProfileSource["source_type"] = "official_documentation", at = "2026-09-20") =>
    validateVerification("test", type, at, v);

  it("accepts a complete human record", () => {
    expect(() => ok(humanRecord())).not.toThrow();
  });

  it("rejects a verification with no date, no author, or a mismatched date", () => {
    expect(() => ok(humanRecord({ verified_at: null }))).toThrow(VerificationError);
    expect(() => ok(humanRecord({ verified_by: null }))).toThrow(/attributable/);
    expect(() => ok(humanRecord({ verified_at: "2026-09-19" }))).toThrow(/must equal last_verified_at/);
  });

  it("requires evidence for every human method", () => {
    for (const method of ["human_page_read", "human_archived_copy", "vendor_reply"] as const) {
      expect(() => ok(humanRecord({ method, evidence: [] }))).toThrow(/requires at least one piece of evidence/);
    }
  });

  it("rejects evidence that is vague or points at unknown fields", () => {
    expect(() => ok(humanRecord({ evidence: [{ quote: "   ", supports: ["ppi.minimum"] }] }))).toThrow(/verbatim quote/);
    expect(() => ok(humanRecord({ evidence: [{ quote: "x", supports: [] }] }))).toThrow(/which fields/);
    expect(() => ok(humanRecord({ evidence: [{ quote: "x", supports: ["made.up.field"] }] }))).toThrow(/unknown field/);
  });

  it("an archived copy must be tamper-evident, and archive-based verification needs one", () => {
    expect(() => ok(humanRecord({ evidence: [{ quote: "x", supports: ["ppi.minimum"], archived_copy: "a.html" }] })))
      .toThrow(/sha256/);
    expect(() => ok(humanRecord({ method: "human_archived_copy" }))).toThrow(/requires an archived file path/);
    expect(() =>
      ok(humanRecord({
        method: "human_archived_copy",
        evidence: [{ quote: "x", supports: ["ppi.minimum"], archived_copy: "a.html", archived_sha256: "abc" }],
      })),
    ).not.toThrow();
  });

  it("nobody can postpone a re-check indefinitely", () => {
    expect(() => ok(humanRecord({ review_due_at: "2026-09-19" }))).toThrow(/after verified_at/);
    expect(() => ok(humanRecord({ review_due_at: addDays("2026-09-20", MAX_EXPLICIT_REVIEW_DAYS + 1) }))).toThrow(/may not be more than/);
    expect(() => ok(humanRecord({ review_due_at: addDays("2026-09-20", 30) }))).not.toThrow();
  });

  it("our own policy cannot stand in for a platform's requirement", () => {
    expect(() => ok(humanRecord({ method: "internal_policy", evidence: [] }), "official_documentation")).toThrow(/cannot be verified by internal policy/);
    expect(() => ok(humanRecord({ method: "internal_policy", evidence: [] }), "printready_policy")).not.toThrow();
  });

  it("'none' means never verified and carries no date", () => {
    expect(() => ok({ method: "none", verified_at: "2026-09-20", verified_by: null, evidence: [] })).toThrow(/cannot carry a verification date/);
    expect(() => ok({ method: "none", verified_at: null, verified_by: null, evidence: [] })).not.toThrow();
  });
});

describe("a profile cannot claim trust it does not have", () => {
  const base = requireProfile("photo.8x10");

  it("rejects review_status 'current' with no verification", () => {
    const bad = {
      ...base,
      source: { ...base.source, verification: { method: "none", verified_at: null, verified_by: null, evidence: [] } },
    } as PrintProfile;
    expect(() => validateProfile(bad)).toThrow(ProfileValidationError);
    expect(() => validateProfile(bad)).toThrow(/requires a verification record/);
  });

  it("rejects a shown quote that is not in the evidence", () => {
    const bad = {
      ...base,
      source: { ...base.source, source_quote: "A sentence nobody recorded." },
    } as PrintProfile;
    expect(() => validateProfile(bad)).toThrow(/must appear in the verification evidence/);
  });
});

describe("review deadlines", () => {
  it("defaults to the maximum age for the source type", () => {
    const v = humanRecord();
    expect(reviewDueAt("official_documentation", v, "2026-09-20")).toBe("2026-12-19"); // +90 days
    expect(reviewDueAt("printready_policy", v, "2026-09-20")).toBe("2027-09-20"); // +365 days
    expect(reviewDueAt("user_supplied", v, "2026-09-20")).toBeNull();
  });

  it("an explicit deadline wins, so a person can ask for an earlier re-check", () => {
    expect(reviewDueAt("official_documentation", humanRecord({ review_due_at: "2026-10-01" }), "2026-09-20")).toBe("2026-10-01");
  });

  it("the shipped profiles all carry a due date (or never expire)", () => {
    for (const d of ["photo_poster", "etsy_printable", "printful", "printify"] as const) {
      for (const p of getGroup(d)!.profiles) {
        const due = dueDate(p.source);
        expect(due === null || /^\d{4}-\d{2}-\d{2}$/.test(due)).toBe(true);
      }
    }
  });
});

describe("automation lowers trust and never raises it", () => {
  const watch = (status: SourceWatchState["sources"][number]["status"]): SourceWatchState => ({
    sources: [{ url: "https://example.com/spec", verifiedHash: "a", lastSeenHash: "b", lastChecked: "2026-09-19", lastChanged: "2026-09-19", status }],
  });

  it("an overdue re-check becomes stale", () => {
    expect(computeFreshness("current", "official_documentation", humanRecord(), "2026-09-20", "unchanged", NOW)).toBe("current");
    const old = humanRecord({ verified_at: "2026-01-01" });
    expect(computeFreshness("current", "official_documentation", old, "2026-01-01", "unchanged", NOW)).toBe("stale");
    // An explicit earlier deadline is honoured too.
    const soon = humanRecord({ review_due_at: "2026-09-19" });
    expect(computeFreshness("current", "official_documentation", soon, "2026-09-20", "unchanged", NOW)).toBe("stale");
  });

  it("a changed page becomes needs-review", () => {
    expect(computeFreshness("current", "official_documentation", humanRecord(), "2026-09-20", "changed-needs-review", NOW)).toBe("needs-review");
  });

  it("no watch state can promote an unverified rule", () => {
    for (const st of ["unchanged", "changed-needs-review", "fetch-failed", "never-checked"] as const) {
      expect(computeFreshness("unverified", "official_documentation", undefined, "2026-09-20", st, NOW)).toBe("unverified");
    }
  });

  it("automation may not claim a source a person verified", () => {
    expect(canAutomationClaim(humanRecord())).toBe(false);
    expect(canAutomationClaim(humanRecord({ method: "vendor_reply" }))).toBe(false);
    expect(canAutomationClaim(humanRecord({ method: "automated_fetch" }))).toBe(true);
    expect(canAutomationClaim({ method: "none", verified_at: null, verified_by: null, evidence: [] })).toBe(true);
    // internal_policy is ours, not a fetched page: the watcher has nothing to take over.
    expect(canAutomationClaim(humanRecord({ method: "internal_policy" }))).toBe(true);
  });

  it("the engine's freshness and the scripts' freshness are the same function", () => {
    const source: ProfileSource = {
      ...requireProfile("photo.8x10").source,
      source_url: "https://example.com/spec",
      source_type: "official_documentation",
      last_verified_at: "2026-01-01",
      verification: humanRecord({ verified_at: "2026-01-01" }),
    };
    expect(effectiveFreshness(source, watch("unchanged"), NOW)).toBe("stale");
    expect(effectiveFreshness(source, watch("changed-needs-review"), NOW)).toBe("needs-review");
    expect(humanVerified(source)).toBe(true);
  });
});

describe("recording a verification", () => {
  const source = (): ProfileSource => ({
    source_url: "https://example.com/spec",
    source_type: "official_documentation",
    last_verified_at: "2026-01-01",
    review_status: "unverified",
    review_required: true,
    profile_version: "1.0.0",
    verification: { method: "none", verified_at: null, verified_by: null, evidence: [] },
  });

  it("turns an unverified source into a current one", () => {
    const out = applyManualVerification(source(), humanRecord());
    expect(out.review_status).toBe("current");
    expect(out.review_required).toBe(false);
    expect(out.last_verified_at).toBe("2026-09-20");
    expect(out.verification.verified_by).toBe("Jane");
    expect(out.source_quote).toBe("Files must be at least 300 DPI.");
  });

  it("never touches the rule values themselves", () => {
    const profile = JSON.parse(JSON.stringify(requireProfile("printful.poster.18x24"))) as PrintProfile;
    const before = JSON.stringify({ ppi: profile.ppi, size: profile.size, max: profile.max_file_size_bytes, fmt: profile.accepted_formats });
    profile.source = applyManualVerification(profile.source, humanRecord());
    const after = JSON.stringify({ ppi: profile.ppi, size: profile.size, max: profile.max_file_size_bytes, fmt: profile.accepted_formats });
    expect(after).toBe(before);
    expect(() => validateProfile(profile)).not.toThrow();
  });

  it("refuses to record 'none' or an automated fetch as a manual verification", () => {
    expect(() => applyManualVerification(source(), { method: "none", verified_at: null, verified_by: null, evidence: [] })).toThrow(VerificationError);
    expect(() => applyManualVerification(source(), humanRecord({ method: "automated_fetch" }))).toThrow(VerificationError);
  });

  it("buildVerification produces a record the validator accepts", () => {
    const v = buildVerification({
      method: "human_page_read",
      verifiedAt: "2026-09-20",
      verifiedBy: "Jane",
      evidence: [{ quote: "Maximum file size: 20MB.", supports: ["max_file_size_bytes"] }],
    });
    expect(() => validateVerification("t", "official_documentation", "2026-09-20", v)).not.toThrow();
  });

  it("finds every profile that cites a URL, so one verification updates them all", () => {
    const groups = {
      "etsy.json": {
        destination: "etsy_printable",
        profiles: [
          { id: "a", source: { source_url: "https://x/1" }, constraints_source: { source_url: "https://x/2" } },
          { id: "b", source: { source_url: "https://x/2" } },
        ],
        marketplace_constraints: { source: { source_url: "https://x/2" } },
      },
    };
    expect(findSources(groups, "https://x/2").map((h: { id: string; kind: string }) => `${h.id}:${h.kind}`)).toEqual([
      "a:constraints_source",
      "b:source",
      "etsy_printable marketplace:marketplace",
    ]);
    expect(findSources(groups, "https://x/none")).toEqual([]);
  });
});

describe("the shipped data tells the truth about itself", () => {
  it("every source carries a verification record", () => {
    for (const d of ["photo_poster", "etsy_printable", "printful", "printify"] as const) {
      const g = getGroup(d)!;
      for (const p of g.profiles) {
        expect(p.source.verification).toBeDefined();
        if (p.source.review_status === "current") expect(p.source.verification.method).not.toBe("none");
        if (p.constraints_source) expect(p.constraints_source.verification).toBeDefined();
      }
      if (g.marketplace_constraints) expect(g.marketplace_constraints.source.verification).toBeDefined();
    }
  });

  it("platform requirements we could not read are recorded as never verified", () => {
    for (const d of ["printful", "printify"] as const) {
      for (const p of getGroup(d)!.profiles) {
        expect(p.source.verification.method).toBe("none");
        expect(p.source.review_status).toBe("unverified");
      }
    }
    const etsy = requireProfile("etsy.2x3");
    expect(etsy.constraints_source!.verification.method).toBe("none");
    // ...while our own policy is recorded as exactly that, and nothing more.
    expect(etsy.source.verification.method).toBe("internal_policy");
    expect(etsy.source.verification.evidence).toEqual([]);
  });
});

describe("a rule nobody checked is never described as due for a re-check", () => {
  it("says it was never verified instead", () => {
    const img = inspectImage(makeJpeg({ width: 3600, height: 5400 }), "a.jpg").inspection!;
    const unverified = runPreflight({ inspection: img, profile: requireProfile("printify.poster.18x24"), now: NOW });
    expect(unverified.advanced["Requirements trust"]).toMatch(/never verified/);
    expect(unverified.advanced["Requirements trust"]).not.toMatch(/re-check by/);

    const ours = runPreflight({ inspection: img, profile: requireProfile("photo.18x24"), now: NOW });
    expect(ours.advanced["Requirements trust"]).toMatch(/re-check by 2027-09-20/);
  });
});
