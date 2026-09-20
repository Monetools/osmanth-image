import { NextResponse } from "next/server";
import { parseJob, quote } from "@/server/enhance";
import { sessionId } from "@/server/session";

/** Price/availability quote. Receives only dimensions — never the image. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const job = parseJob(body);
  if (!job) return NextResponse.json({ error: "invalid job" }, { status: 400 });
  return NextResponse.json(await quote(job, await sessionId()), { headers: { "cache-control": "no-store" } });
}
