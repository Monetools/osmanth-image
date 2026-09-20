import type { CostEstimate, EnhancementJob } from "./provider";

/**
 * Mandatory Cost Gate (spec §12). EVERY operation with meaningful GPU/API/server cost goes through
 * `evaluateGate`. There is no code path that runs a provider without an allowed decision.
 */
export interface Entitlement {
  userId: string | null;
  anonymous: boolean;
  credits: number;
  /** Free preview allowance remaining (small representative crops only). */
  freePreviewsRemaining: number;
}

export interface GateDecision {
  allowed: boolean;
  estimated_compute_cost: number;
  required_credits: number;
  user_entitlement: { anonymous: boolean; credits: number; freePreviewsRemaining: number };
  reason:
    | "ok_paid"
    | "ok_free_preview"
    | "anonymous_full_resolution"
    | "insufficient_credits"
    | "preview_quota_exhausted"
    | "preview_too_large"
    | "cost_not_measured";
}

/** Price policy knobs. Retail prices are NOT set until PRINTREADY_UNIT_ECONOMICS.md has measured data. */
export interface CreditPolicy {
  /** USD of marginal cost covered by one credit. */
  usdPerCredit: number;
  minimumCredits: number;
  /** Largest free preview crop (pixels, input side). */
  maxPreviewInputPixels: number;
  /** Refuse to charge (or run) anything whose cost is a placeholder rather than a measurement. */
  requireMeasuredCost: boolean;
}

export const DEFAULT_POLICY: CreditPolicy = {
  usdPerCredit: 0.01,
  minimumCredits: 1,
  maxPreviewInputPixels: 256 * 256,
  requireMeasuredCost: true,
};

export function requiredCredits(cost: CostEstimate, policy: CreditPolicy = DEFAULT_POLICY): number {
  return Math.max(policy.minimumCredits, Math.ceil(cost.usd / policy.usdPerCredit));
}

export function evaluateGate(
  job: EnhancementJob,
  cost: CostEstimate,
  ent: Entitlement,
  policy: CreditPolicy = DEFAULT_POLICY,
): GateDecision {
  const credits = requiredCredits(cost, policy);
  const base = {
    estimated_compute_cost: cost.usd,
    required_credits: job.mode === "preview" ? 0 : credits,
    user_entitlement: { anonymous: ent.anonymous, credits: ent.credits, freePreviewsRemaining: ent.freePreviewsRemaining },
  };
  if (policy.requireMeasuredCost && !cost.measured) return { ...base, allowed: false, reason: "cost_not_measured" };
  if (job.mode === "preview") {
    if (job.inputWidth * job.inputHeight > policy.maxPreviewInputPixels) return { ...base, allowed: false, reason: "preview_too_large" };
    if (ent.freePreviewsRemaining <= 0) return { ...base, allowed: false, reason: "preview_quota_exhausted" };
    return { ...base, allowed: true, reason: "ok_free_preview" };
  }
  // Full-resolution work: never for anonymous users, never silently free (spec §12, red line 13).
  if (ent.anonymous || !ent.userId) return { ...base, allowed: false, reason: "anonymous_full_resolution" };
  if (ent.credits < credits) return { ...base, allowed: false, reason: "insufficient_credits" };
  return { ...base, allowed: true, reason: "ok_paid" };
}
