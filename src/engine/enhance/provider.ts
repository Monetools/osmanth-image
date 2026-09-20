/**
 * EnhancementProvider abstraction (spec §8). The product is never wired to one model: providers
 * register capabilities + cost models, the router picks one, and the cost gate decides whether the
 * job may run at all.
 */
export type ProviderKind = "local_open_source" | "external_api" | "self_hosted_gpu" | "premium";
export type ImageKind = "photo" | "illustration" | "graphic_text" | "unknown";

export interface EnhancementJob {
  inputWidth: number;
  inputHeight: number;
  scale: 2 | 4;
  imageKind: ImageKind;
  hasFaces: boolean;
  /** Face restoration is opt-in only (spec §9, red line 17). */
  faceRestoration: boolean;
  /** "preview" = representative crop only; "full" = full resolution deliverable. */
  mode: "preview" | "full";
  quality: "standard" | "premium";
}

export interface CostEstimate {
  /** Marginal compute/API cost in USD, from measured benchmark numbers (see PRINTREADY_UNIT_ECONOMICS.md). */
  usd: number;
  /** Expected wall time in seconds. */
  seconds: number;
  /** true when the numbers come from a real benchmark rather than a placeholder. */
  measured: boolean;
}

export interface ProviderGates {
  /** Benchmarked on the §23 corpus and results recorded in PRINTREADY_MODEL_BENCHMARK.md. */
  benchmarked: boolean;
  /** Code AND weight licences cleared in PRINTREADY_OSS_LICENSE_AUDIT.md. */
  licenseCleared: boolean;
  /** Operationally configured (endpoint/key present). */
  configured: boolean;
}

export interface EnhancementResult {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  providerId: string;
  model: string;
  seconds: number;
}

export interface EnhancementProvider {
  id: string;
  kind: ProviderKind;
  model: string;
  supportedScales: (2 | 4)[];
  maxInputPixels: number;
  goodFor: ImageKind[];
  gates(): ProviderGates;
  estimate(job: EnhancementJob): CostEstimate;
  run(job: EnhancementJob, input: Uint8Array, signal?: AbortSignal): Promise<EnhancementResult>;
}

export function isUsable(p: EnhancementProvider): boolean {
  const g = p.gates();
  return g.benchmarked && g.licenseCleared && g.configured;
}
