import { isUsable, type EnhancementJob, type EnhancementProvider } from "./provider";

export interface RouteDecision {
  provider: EnhancementProvider | null;
  /** Why this provider (or why none). */
  reason: string;
  rejected: { id: string; reason: string }[];
}

/**
 * Pick a provider for a job (spec §8) from source/target size, scale, image type, faces, quality
 * requirement and estimated cost. Providers that haven't passed the benchmark AND licence gates
 * are never selected, whatever else is true.
 */
export function routeEnhancement(job: EnhancementJob, providers: readonly EnhancementProvider[]): RouteDecision {
  const rejected: RouteDecision["rejected"] = [];
  const candidates: { p: EnhancementProvider; score: number }[] = [];
  for (const p of providers) {
    const g = p.gates();
    if (!g.benchmarked) { rejected.push({ id: p.id, reason: "not benchmarked on the PrintReady corpus" }); continue; }
    if (!g.licenseCleared) { rejected.push({ id: p.id, reason: "code/model-weight licence not cleared" }); continue; }
    if (!g.configured) { rejected.push({ id: p.id, reason: "not configured" }); continue; }
    if (!p.supportedScales.includes(job.scale)) { rejected.push({ id: p.id, reason: `no ${job.scale}× support` }); continue; }
    if (job.inputWidth * job.inputHeight > p.maxInputPixels) { rejected.push({ id: p.id, reason: "input too large" }); continue; }
    const est = p.estimate(job);
    let score = 100 - est.usd * 1000 - est.seconds * 0.2;
    if (p.goodFor.includes(job.imageKind)) score += 30;
    if (job.imageKind === "graphic_text" && !p.goodFor.includes("graphic_text")) score -= 40;
    if (job.quality === "premium" && p.kind === "premium") score += 50;
    if (!est.measured) score -= 25;
    candidates.push({ p, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]?.p ?? null;
  return {
    provider: best,
    reason: best ? `selected ${best.id} (${best.model})` : "no enhancement provider is currently enabled",
    rejected,
  };
}

export function anyProviderUsable(providers: readonly EnhancementProvider[]): boolean {
  return providers.some(isUsable);
}
