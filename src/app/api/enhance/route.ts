import { NextResponse } from "next/server";
import { evaluateGate } from "@/engine/enhance/costGate";
import { defaultProviders } from "@/engine/enhance/providers";
import { routeEnhancement } from "@/engine/enhance/router";
import { inspectImage } from "@/engine/inspect/inspect";
import { LIMITS } from "@/engine/security/limits";
import { credits } from "@/server/credits";
import { parseJob } from "@/server/enhance";
import { sessionId } from "@/server/session";

export const runtime = "nodejs";

/**
 * Gated enhancement endpoint. Order is deliberate: cheap validation → routing → COST GATE →
 * credit reservation → provider. The image lives only in memory for the duration of the request;
 * nothing is written to disk and no URL to it ever exists (spec §19).
 */
export async function POST(req: Request) {
  const noStore = { "cache-control": "no-store" };
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.maxFileBytes) return NextResponse.json({ error: "file too large" }, { status: 413, headers: noStore });

  const url = new URL(req.url);
  let raw: unknown = null;
  try {
    raw = JSON.parse(url.searchParams.get("job") ?? "null");
  } catch {
    raw = null;
  }
  const job = parseJob(raw);
  if (!job) return NextResponse.json({ error: "invalid job" }, { status: 400, headers: noStore });

  // Route + gate BEFORE reading the body: unpaid requests never cost bandwidth or compute.
  const route = routeEnhancement(job, defaultProviders());
  if (!route.provider) {
    return NextResponse.json({ error: "enhancement unavailable", reason: route.reason }, { status: 503, headers: noStore });
  }
  const sid = await sessionId();
  const ent = await credits.entitlement(sid, null);
  const gate = evaluateGate(job, route.provider.estimate(job), ent);
  if (!gate.allowed) return NextResponse.json({ error: "not entitled", gate }, { status: 402, headers: noStore });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > LIMITS.maxFileBytes) return NextResponse.json({ error: "file too large" }, { status: 413, headers: noStore });
  const { inspection, error } = inspectImage(bytes, "upload", req.headers.get("content-type"));
  if (!inspection || error) return NextResponse.json({ error: error?.message ?? "invalid image" }, { status: 422, headers: noStore });
  if (inspection.width !== job.inputWidth || inspection.height !== job.inputHeight) {
    return NextResponse.json({ error: "image does not match the quoted job" }, { status: 422, headers: noStore });
  }
  if (inspection.width * inspection.height > Math.min(LIMITS.serverMaxInputPixels, route.provider.maxInputPixels)) {
    return NextResponse.json({ error: "image too large for enhancement" }, { status: 413, headers: noStore });
  }

  const jobId = crypto.randomUUID();
  const charged = job.mode === "full" ? gate.required_credits : 0;
  if (charged > 0) {
    if (!ent.userId || !(await credits.reserve(ent.userId, charged, jobId))) {
      return NextResponse.json({ error: "insufficient credits" }, { status: 402, headers: noStore });
    }
  } else {
    await credits.consumePreview(sid);
  }
  const abort = AbortSignal.timeout(LIMITS.serverJobTimeoutMs);
  try {
    const result = await route.provider.run(job, bytes, abort);
    return new NextResponse(result.bytes as unknown as BodyInit, {
      headers: { ...noStore, "content-type": result.mime, "x-provider": result.providerId, "x-model": result.model },
    });
  } catch {
    if (charged > 0 && ent.userId) await credits.refund(ent.userId, charged, jobId);
    return NextResponse.json({ error: "enhancement failed; you were not charged" }, { status: 502, headers: noStore });
  }
}
