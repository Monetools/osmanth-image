import "server-only";
import { evaluateGate, type GateDecision } from "@/engine/enhance/costGate";
import type { EnhancementJob, ImageKind } from "@/engine/enhance/provider";
import { defaultProviders } from "@/engine/enhance/providers";
import { routeEnhancement } from "@/engine/enhance/router";
import { credits } from "./credits";

export interface QuoteResponse {
  available: boolean;
  provider: string | null;
  routeReason: string;
  gate: GateDecision | null;
  /** Plain-language message for the UI. */
  message: string;
}

export function parseJob(body: unknown): EnhancementJob | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 30000 ? v : null);
  const w = int(b.inputWidth);
  const h = int(b.inputHeight);
  const scale = b.scale === 2 || b.scale === 4 ? b.scale : null;
  const kinds: ImageKind[] = ["photo", "illustration", "graphic_text", "unknown"];
  if (!w || !h || !scale) return null;
  return {
    inputWidth: w,
    inputHeight: h,
    scale,
    imageKind: kinds.includes(b.imageKind as ImageKind) ? (b.imageKind as ImageKind) : "unknown",
    hasFaces: b.hasFaces === true,
    faceRestoration: b.faceRestoration === true && b.hasFaces === true,
    mode: b.mode === "preview" ? "preview" : "full",
    quality: b.quality === "premium" ? "premium" : "standard",
  };
}

export async function quote(job: EnhancementJob, sessionId: string | null): Promise<QuoteResponse> {
  const route = routeEnhancement(job, defaultProviders());
  if (!route.provider) {
    return {
      available: false, provider: null, routeReason: route.reason, gate: null,
      message: "AI enlargement isn't switched on yet. Your free check and all basic fixes still work.",
    };
  }
  const ent = await credits.entitlement(sessionId, null);
  const gate = evaluateGate(job, route.provider.estimate(job), ent);
  const messages: Record<GateDecision["reason"], string> = {
    ok_paid: "Ready to enlarge.",
    ok_free_preview: "Free preview available.",
    anonymous_full_resolution: "Full-size AI enlargement needs credits. The preview and all basic fixes are free.",
    insufficient_credits: "You don't have enough credits for this enlargement.",
    preview_quota_exhausted: "You've used your free previews.",
    preview_too_large: "Previews use a small sample of the image.",
    cost_not_measured: "AI enlargement is waiting for cost measurements before it can be offered.",
  };
  return { available: gate.allowed, provider: route.provider.id, routeReason: route.reason, gate, message: messages[gate.reason] };
}
