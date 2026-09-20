import type { CostEstimate, EnhancementJob, EnhancementProvider, EnhancementResult, ProviderGates } from "./provider";

/**
 * Concrete providers. Gate flags are set by humans after the benchmark (PRINTREADY_MODEL_BENCHMARK.md)
 * and licence audit (PRINTREADY_OSS_LICENSE_AUDIT.md) are complete. Until then they stay false and
 * the router will not select them — the product keeps working without AI (spec pre-build gate).
 */
export const PROVIDER_GATES: Record<string, Omit<ProviderGates, "configured">> = {
  // Benchmark and licence decisions pending — see docs. Do NOT flip without updating both documents.
  "realesrgan-selfhosted": { benchmarked: false, licenseCleared: false },
};

/**
 * Real-ESRGAN running on a self-hosted GPU worker (benchmark/worker in this repo). The worker is an
 * internal service: it receives bytes over an authenticated POST, returns bytes, and stores nothing.
 */
export class RealEsrganSelfHosted implements EnhancementProvider {
  id = "realesrgan-selfhosted";
  kind = "self_hosted_gpu" as const;
  model = "RealESRGAN_x4plus";
  supportedScales: (2 | 4)[] = [2, 4];
  maxInputPixels = 25_000_000;
  goodFor = ["photo" as const, "illustration" as const];

  constructor(
    private readonly endpoint: string | undefined = process.env.PRINTREADY_GPU_WORKER_URL,
    private readonly token: string | undefined = process.env.PRINTREADY_GPU_WORKER_TOKEN,
    /** Measured seconds per output megapixel on the reference GPU; null until benchmarked. */
    private readonly secondsPerOutputMp: number | null = null,
    /** GPU cost per second (USD) for the deployment target; null until priced. */
    private readonly usdPerGpuSecond: number | null = null,
  ) {}

  gates(): ProviderGates {
    const g = PROVIDER_GATES[this.id] ?? { benchmarked: false, licenseCleared: false };
    return { ...g, configured: Boolean(this.endpoint && this.token) };
  }

  estimate(job: EnhancementJob): CostEstimate {
    const outMp = (job.inputWidth * job.inputHeight * job.scale * job.scale) / 1e6;
    if (this.secondsPerOutputMp === null || this.usdPerGpuSecond === null) {
      // Placeholder only; `measured: false` makes the cost gate refuse the job.
      return { usd: outMp * 0.002, seconds: outMp * 1.5, measured: false };
    }
    const seconds = outMp * this.secondsPerOutputMp;
    return { usd: seconds * this.usdPerGpuSecond, seconds, measured: true };
  }

  async run(job: EnhancementJob, input: Uint8Array, signal?: AbortSignal): Promise<EnhancementResult> {
    if (!this.endpoint || !this.token) throw new Error("GPU worker not configured");
    const started = Date.now();
    const res = await fetch(`${this.endpoint}/v1/upscale?scale=${job.scale}&face=${job.faceRestoration ? 1 : 0}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/octet-stream" },
      body: input as unknown as BodyInit,
      signal,
    });
    if (!res.ok) throw new Error(`GPU worker returned ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes, mime: "image/png",
      width: Number(res.headers.get("x-output-width") ?? 0),
      height: Number(res.headers.get("x-output-height") ?? 0),
      providerId: this.id, model: this.model, seconds: (Date.now() - started) / 1000,
    };
  }
}

export function defaultProviders(): EnhancementProvider[] {
  return [new RealEsrganSelfHosted()];
}
