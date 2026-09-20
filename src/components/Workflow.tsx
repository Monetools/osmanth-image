"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inspectImage } from "@/engine/inspect/inspect";
import type { ImageInspection } from "@/engine/inspect/types";
import { buildCustomProfile, getGroup, getProfile } from "@/engine/profiles/registry";
import type { DestinationId, LengthUnit, PrintProfile } from "@/engine/profiles/schema";
import { runPreflight, suggestSizes, type Issue, type PrintStatus } from "@/engine/preflight/preflight";
import { COVERAGE_LABEL, coverageLine } from "@/engine/preflight/coverage";
import { planFix } from "@/engine/fix/planner";
import { verifyOutput, type VerificationResult } from "@/engine/verify/verify";
import type { Intent } from "@/engine/intents";
import { formatBytes, formatInches } from "@/engine/units";
import { sanitizeFileName } from "@/engine/etsy/pack";
import { alphaUsed as scanAlpha, decode, outputAlphaUsed, renderSpec, RenderError } from "@/browser/render";
import { CropPreview } from "./CropPreview";
import { EtsyPack } from "./EtsyPack";

interface Loaded {
  file: File;
  url: string;
  inspection: ImageInspection;
  alphaUsed: boolean | null;
}

interface Output {
  url: string;
  name: string;
  bytes: number;
  verification: VerificationResult;
  notes: string[];
}

const DESTINATIONS: { id: DestinationId; label: string; hint: string }[] = [
  { id: "photo_poster", label: "Photo / Poster", hint: "Prints, frames, wall art" },
  { id: "etsy_printable", label: "Etsy Printable", hint: "Digital download pack" },
  { id: "printful", label: "Printful", hint: "Print-on-demand" },
  { id: "printify", label: "Printify", hint: "Print-on-demand" },
  { id: "custom", label: "Custom size", hint: "Any width × height" },
];

const STATUS_ICON: Record<PrintStatus, string> = {
  READY: "✓", READY_WITH_WARNINGS: "✓", FIXABLE: "↻", REVIEW_RECOMMENDED: "⚠", NOT_RECOMMENDED: "✕", UNVERIFIED: "?",
};

export function Workflow({ intent }: { intent?: Intent }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [destination, setDestination] = useState<DestinationId | null>(intent?.destination ?? null);
  const [profileId, setProfileId] = useState<string | null>(intent?.profileId ?? null);
  const [custom, setCustom] = useState<{ w: number; h: number; unit: LengthUnit }>({ w: 8, h: 10, unit: "in" });
  const [aspectMode, setAspectMode] = useState<"crop" | "fit">("crop");
  const [cropOffset, setCropOffset] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs are revoked when replaced (not in effect cleanups, which StrictMode double-runs).
  const outputUrl = useRef<string | null>(null);
  const replaceOutput = useCallback((o: Output | null) => {
    if (outputUrl.current && outputUrl.current !== o?.url) URL.revokeObjectURL(outputUrl.current);
    outputUrl.current = o?.url ?? null;
    setOutput(o);
  }, []);

  const onFile = useCallback(async (file: File) => {
    setLoadError(null);
    replaceOutput(null);
    setRenderError(null);
    setCropOffset(0);
    setAspectMode("crop");
    // Inspection reads the bytes locally. Nothing is uploaded.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { inspection, error } = inspectImage(bytes, file.name, file.type || null);
    if (!inspection || error) {
      setLoaded((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
      setLoadError(error?.message ?? "We couldn't read this file.");
      return;
    }
    let used: boolean | null = null;
    if (inspection.hasAlphaChannel) {
      try {
        const bmp = await decode(file);
        used = scanAlpha(bmp);
        bmp.close();
      } catch {
        used = null;
      }
    }
    const url = URL.createObjectURL(file);
    setLoaded((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url, inspection, alphaUsed: used }; });
  }, [replaceOutput]);

  const profile: PrintProfile | null = useMemo(() => {
    if (destination === "custom") {
      if (!(custom.w > 0 && custom.h > 0)) return null;
      try {
        return buildCustomProfile({ width: custom.w, height: custom.h, unit: custom.unit });
      } catch {
        return null;
      }
    }
    const p = profileId ? getProfile(profileId) : undefined;
    return p && p.destination === destination ? p : null;
  }, [destination, profileId, custom]);

  const group = destination && destination !== "custom" ? getGroup(destination) : undefined;

  const pre = useMemo(() => {
    if (!loaded || !profile) return null;
    return runPreflight({
      inspection: loaded.inspection, profile, alphaUsed: loaded.alphaUsed, cropOffset, aspectMode,
      enhancementAvailable: false,
    });
  }, [loaded, profile, cropOffset, aspectMode]);

  const plan = useMemo(() => (loaded && profile && pre ? planFix(loaded.inspection, profile, pre, { aspectMode, cropOffset }) : null), [loaded, profile, pre, aspectMode, cropOffset]);

  const suggestions = useMemo(
    () => (loaded && group && destination !== "etsy_printable" ? suggestSizes(loaded.inspection, group.profiles).slice(0, 4) : []),
    [loaded, group, destination],
  );

  // Any change to the job invalidates a previously produced file.
  useEffect(() => replaceOutput(null), [profile, cropOffset, aspectMode, loaded, replaceOutput]);

  const prepare = useCallback(async () => {
    if (!loaded || !profile || !plan || !pre) return;
    setBusy(true);
    setRenderError(null);
    try {
      const bmp = await decode(loaded.file);
      let r;
      try {
        r = await renderSpec(bmp, plan.spec);
      } finally {
        bmp.close();
      }
      const ext = profile.output_format === "jpeg" ? "jpg" : "png";
      const name = sanitizeFileName(loaded.file.name, profile.variant.replace(/[×x]/g, "x").replace(/\s+/g, ""), ext);
      const verification = verifyOutput(r.bytes, name, profile, r.spec, {
        outputAlphaUsed: await outputAlphaUsed(r.bytes, r.mime),
        source: { jpegQuality: loaded.inspection.jpegQuality, sharpness: null },
        enhancementScale: 1,
        colorConverted: plan.steps.some((s) => s.kind === "color"),
        thresholds: pre.thresholds,
      });
      const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
      replaceOutput({ url, name, bytes: r.bytes.length, verification, notes: r.notes });
    } catch (e) {
      setRenderError(e instanceof RenderError ? e.message : "Something went wrong preparing the file. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [loaded, profile, plan, pre, replaceOutput]);

  const aspectIssue = pre?.issues.find((i) => i.category === "aspect");

  return (
    <div>
      {/* Step 1 — upload */}
      <section className="card" aria-labelledby="s1">
        <div className="step-label">Step 1</div>
        <h2 id="s1">Your image</h2>
        {loaded ? (
          <div className="file-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loaded.url} alt="" />
            <div className="meta">
              <div className="name">{loaded.file.name}</div>
              <div className="sub">
                {loaded.inspection.width} × {loaded.inspection.height} pixels · {loaded.inspection.format.toUpperCase()} · {formatBytes(loaded.inspection.fileSizeBytes)}
              </div>
            </div>
            <button className="btn secondary small" onClick={() => inputRef.current?.click()}>Change</button>
          </div>
        ) : (
          <div
            className={`drop${drag ? " drag" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
          >
            <strong>Choose an image or drop it here</strong>
            <small>JPEG, PNG or WebP. It stays on your device — nothing is uploaded.</small>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}
        />
        {loadError && <p className="error" role="alert">{loadError}</p>}
        {loaded?.inspection.warnings.map((w) => <p key={w} className="notice">{w}</p>)}
      </section>

      {/* Step 2 — destination */}
      <section className="card" aria-labelledby="s2">
        <div className="step-label">Step 2</div>
        <h2 id="s2">Where are you printing this?</h2>
        <div className="choices">
          {DESTINATIONS.map((d) => (
            <button
              key={d.id}
              className="choice"
              aria-pressed={destination === d.id}
              onClick={() => {
                setDestination(d.id);
                if (d.id !== destination) setProfileId(null);
              }}
            >
              <b>{d.label}</b>
              <small>{d.hint}</small>
            </button>
          ))}
        </div>

        {destination && destination !== "etsy_printable" && destination !== "custom" && group && (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="size">{destination === "photo_poster" ? "Print size" : "Product"}</label>
              <select id="size" value={profileId ?? ""} onChange={(e) => setProfileId(e.target.value || null)}>
                <option value="">Choose…</option>
                {group.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {destination === "photo_poster" ? p.variant : `${p.product} — ${p.variant}`}
                  </option>
                ))}
              </select>
            </div>
            {loaded && suggestions.length > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Good fits for this image:{" "}
                {suggestions.map((s, i) => (
                  <span key={s.profile.id}>
                    {i > 0 && ", "}
                    <button className="link-btn" onClick={() => setProfileId(s.profile.id)}>{s.profile.variant}</button>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}

        {destination === "custom" && (
          <div className="row" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="cw">Width</label>
              <input id="cw" type="number" min={1} step="any" value={custom.w} onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="ch">Height</label>
              <input id="ch" type="number" min={1} step="any" value={custom.h} onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="cu">Unit</label>
              <select id="cu" value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value as LengthUnit })}>
                <option value="in">inches</option>
                <option value="mm">mm</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {destination === "etsy_printable" && loaded && <EtsyPack loaded={loaded} />}
      {destination === "etsy_printable" && !loaded && <p className="notice">Add your artwork above to plan the pack.</p>}

      {/* Step 3 — report */}
      {pre && plan && profile && loaded && destination !== "etsy_printable" && (
        <section className="card" aria-labelledby="s3">
          <div className="step-label">Step 3</div>
          <h2 id="s3">Print check</h2>
          <div className={`status ${pre.status}`} role="status">
            <h3>{STATUS_ICON[pre.status]} {pre.summary.headline}</h3>
            <p>{pre.quality.headline}</p>
            {pre.summary.issuesFound > 0 && (
              <ul className="counts">
                <li>{pre.summary.issuesFound} {pre.summary.issuesFound === 1 ? "thing" : "things"} to note</li>
                {pre.summary.autoFixable > 0 && <li>✓ {pre.summary.autoFixable} fixed automatically</li>}
                {pre.summary.needsDecision > 0 && <li>⚠ {pre.summary.needsDecision} {pre.summary.needsDecision === 1 ? "needs" : "need"} your decision</li>}
              </ul>
            )}
          </div>

          {pre.issues.length > 0 && (
            <ul className="issues">
              {pre.issues.map((i) => <IssueRow key={i.id} issue={i} />)}
            </ul>
          )}

          <div className="preview-box" style={{ marginTop: 16 }}>
            <b>What will be printed</b>
            <CropPreview
              src={loaded.url}
              imageW={loaded.inspection.width}
              imageH={loaded.inspection.height}
              crop={pre.crop}
              mode={aspectMode}
              targetRatio={pre.target.fullW / pre.target.fullH}
            />
            {aspectIssue && (
              <div className="stack">
                <div className="row" role="radiogroup" aria-label="How to handle the shape">
                  <button className="choice" aria-pressed={aspectMode === "crop"} onClick={() => setAspectMode("crop")}>
                    <b>Fill the print</b><small>Trim the edges</small>
                  </button>
                  <button className="choice" aria-pressed={aspectMode === "fit"} onClick={() => setAspectMode("fit")}>
                    <b>Keep everything</b><small>Add white borders</small>
                  </button>
                </div>
                {aspectMode === "crop" && pre.crop.axis !== "none" && (
                  <div className="field">
                    <label htmlFor="off">Move the crop {pre.crop.axis === "x" ? "left / right" : "up / down"}</label>
                    <input id="off" className="slider" type="range" min={-1} max={1} step={0.01} value={cropOffset} onChange={(e) => setCropOffset(Number(e.target.value))} />
                  </div>
                )}
              </div>
            )}
          </div>

          {plan.ai && (
            <AiCard ai={plan.ai} maxSize={pre.maxRecommendedSize.atMinimum} />
          )}

          <details className="advanced">
            <summary>What we checked ({coverageLine(pre.coverage)})</summary>
            <table className="kv"><tbody>
              {pre.coverage.map((c) => (
                <tr key={c.id}>
                  <td><span className={`cov cov-${c.state}`}>{COVERAGE_LABEL[c.state]}</span> {c.label}</td>
                  <td>{c.note}</td>
                </tr>
              ))}
            </tbody></table>
          </details>

          <details className="advanced">
            <summary>Advanced details</summary>
            <table className="kv"><tbody>
              {Object.entries(pre.advanced).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
              <tr><td>Prints well up to</td><td>{formatInches(pre.maxRecommendedSize.atMinimum.w)} × {formatInches(pre.maxRecommendedSize.atMinimum.h)} (sharp up to {formatInches(pre.maxRecommendedSize.atPreferred.w)} × {formatInches(pre.maxRecommendedSize.atPreferred.h)})</td></tr>
              {profile.source.source_url && (
                <tr>
                  <td>{profile.source.source_type === "official_documentation" ? "Requirements source" : "Quality guideline"}</td>
                  <td>
                    {profile.source.source_type === "official_documentation" ? null : "PrintReady guideline (not a printer requirement); background: "}
                    <a href={profile.source.source_url} target="_blank" rel="noreferrer noopener">{new URL(profile.source.source_url).hostname}</a>
                  </td>
                </tr>
              )}
            </tbody></table>
          </details>
        </section>
      )}

      {/* Step 4 — fix & verify */}
      {pre && plan && profile && loaded && destination !== "etsy_printable" && (
        <section className="card" aria-labelledby="s4">
          <div className="step-label">Step 4</div>
          <h2 id="s4">Prepare your file</h2>
          <ul className="muted" style={{ marginTop: 0 }}>
            {plan.steps.map((s, i) => <li key={i}>{s.label}</li>)}
          </ul>
          <p className="muted">Output: {plan.spec.canvas.w} × {plan.spec.canvas.h} pixels, {profile.output_format.toUpperCase()}.</p>
          {aspectIssue?.resolution === "decision" && aspectMode === "crop" && (
            <p className="notice">Check the preview above — the darkened area will be cut off.</p>
          )}
          <button className="btn" onClick={prepare} disabled={busy}>
            {busy ? "Preparing…" : output ? "Prepare again" : "Prepare print file"}
          </button>
          {renderError && <p className="error" role="alert">{renderError}</p>}
          {output && <Result output={output} />}
        </section>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const tag = { auto: "We'll fix this", decision: "Your choice", ai: "AI can help", none: "" }[issue.resolution];
  return (
    <li className={`issue ${issue.severity === "blocker" ? "blocker" : issue.resolution}`}>
      <b>
        {issue.title}
        {tag && <span className={`tag ${issue.resolution}`}>{tag}</span>}
      </b>
      <p>{issue.detail}</p>
    </li>
  );
}

function AiCard({ ai, maxSize }: { ai: NonNullable<ReturnType<typeof planFix>["ai"]>; maxSize: { w: number; h: number } }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const check = async () => {
    setLoading(true);
    try {
      // Only dimensions are sent — never the image.
      const r = await fetch("/api/enhance/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputWidth: ai.inputPixels.w, inputHeight: ai.inputPixels.h, scale: ai.scale, imageKind: "unknown", mode: "full" }),
      });
      const j = await r.json();
      setMsg(j.message ?? "AI enlargement isn't available right now.");
    } catch {
      setMsg("AI enlargement isn't available right now.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="notice" style={{ marginTop: 16 }}>
      <b style={{ color: "var(--text)" }}>Options for more detail</b>
      <ul style={{ margin: "6px 0" }}>
        <li>Print smaller: this image looks good up to about {formatInches(maxSize.w)} × {formatInches(maxSize.h)}.</li>
        <li>
          AI enlargement ({ai.scale}×): {ai.reason} AI adds new pixels — it can&apos;t recover detail that was never captured.{" "}
          <button className="link-btn" onClick={check} disabled={loading}>{loading ? "Checking…" : "Check availability"}</button>
        </li>
      </ul>
      {msg && <p style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}

function Result({ output }: { output: Output }) {
  const v = output.verification;
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className={`status ${v.status}`} role="status">
        <h3>{STATUS_ICON[v.status]} {v.label}</h3>
        <p>We re-opened the finished file and checked it against the requirements.</p>
      </div>
      {[...output.notes, ...v.notes].map((n) => <p key={n} className="notice">{n}</p>)}
      {v.verified && (
        <a className="btn" href={output.url} download={output.name}>
          Download {output.name} ({formatBytes(output.bytes)})
        </a>
      )}
      <details className="advanced">
        <summary>What we checked</summary>
        <table className="kv"><tbody>
          {v.checks.map((c) => (
            <tr key={c.name}>
              <td>
                <span className={c.state === "passed" ? "check-ok" : c.state === "failed" ? "check-bad" : "check-unknown"}>
                  {c.state === "passed" ? "✓" : c.state === "failed" ? "✕" : "?"}
                </span>{" "}
                {c.name}
              </td>
              <td>
                {c.actual} <span className="muted">(needs {c.expected})</span>
                {c.note && <div className="muted">{c.note}</div>}
              </td>
            </tr>
          ))}
        </tbody></table>
      </details>
    </div>
  );
}
