"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageInspection } from "@/engine/inspect/types";
import { getGroup } from "@/engine/profiles/registry";
import { packageUploads, planEtsyPack, zipAll, PackError, type PackFile } from "@/engine/etsy/pack";
import { verifyOutput, type VerificationResult } from "@/engine/verify/verify";
import { formatBytes } from "@/engine/units";
import { decode, renderSpec, RenderError } from "@/browser/render";
import { CropPreview } from "./CropPreview";

interface Props {
  loaded: { file: File; url: string; inspection: ImageInspection };
}

interface Generated {
  files: { name: string; bytes: number; verification: VerificationResult; notes: string[]; ratio: string }[];
  uploads: { name: string; url: string; bytes: number; contains: string[] }[];
  all: { url: string; name: string; bytes: number };
}

export function EtsyPack({ loaded }: Props) {
  const group = getGroup("etsy_printable")!;
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState<Generated | null>(null);
  const urls = useRef<string[]>([]);

  const plan = useMemo(() => planEtsyPack(loaded.inspection, group, offsets, confirmed), [loaded, group, offsets, confirmed]);

  const clearGenerated = useCallback(() => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    setGen(null);
  }, []);
  useEffect(() => clearGenerated(), [offsets, confirmed, loaded, clearGenerated]);

  const generate = useCallback(async () => {
    setError(null);
    clearGenerated();
    const files: PackFile[] = [];
    const report: Generated["files"] = [];
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await decode(loaded.file);
      for (const item of plan.items) {
        setBusy(`Preparing ${item.profile.ratio_family?.label ?? item.profile.variant}…`);
        const r = await renderSpec(bmp, item.plan.spec);
        // Every file goes back through the Verification Engine before it can be packaged.
        const verification = verifyOutput(r.bytes, item.fileName, item.profile, r.spec, {
          outputAlphaUsed: false,
          source: { jpegQuality: loaded.inspection.jpegQuality, sharpness: null },
          enhancementScale: 1,
          colorConverted: item.plan.steps.some((s) => s.kind === "color"),
          thresholds: item.preflight.thresholds,
        });
        if (!verification.verified) throw new PackError(`${item.fileName} failed verification.`);
        files.push({ name: item.fileName, bytes: r.bytes });
        report.push({ name: item.fileName, bytes: r.bytes.length, verification, notes: r.notes, ratio: item.profile.ratio_family?.label ?? "" });
      }
      setBusy("Packaging…");
      const c = plan.constraints!;
      const ups = packageUploads(files, c, loaded.file.name);
      const mk = (bytes: Uint8Array, type: string) => {
        const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        urls.current.push(u);
        return u;
      };
      const all = zipAll(files);
      setGen({
        files: report,
        uploads: ups.map((u) => ({
          name: u.name, bytes: u.bytes.length, contains: u.contains,
          url: mk(u.bytes, u.name.endsWith(".zip") ? "application/zip" : "image/jpeg"),
        })),
        all: { url: mk(all, "application/zip"), name: "all-print-files.zip", bytes: all.length },
      });
    } catch (e) {
      setError(e instanceof RenderError || e instanceof PackError ? e.message : "Something went wrong generating the pack.");
    } finally {
      bmp?.close();
      setBusy(null);
    }
  }, [plan, loaded, clearGenerated]);

  return (
    <section className="card" aria-labelledby="etsy">
      <div className="step-label">Step 3</div>
      <h2 id="etsy">Your Etsy printable pack</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        One file per shape. Nothing is stretched — each file is a crop of your artwork. Check what each crop keeps.
      </p>
      <div className="pack-grid">
        {plan.items.map((item) => {
          const label = item.profile.ratio_family?.label ?? item.profile.variant;
          const pct = (item.loss * 100).toFixed(0);
          return (
            <div className="pack-item" key={item.profile.id}>
              <h4>{label}</h4>
              <CropPreview
                src={loaded.url}
                imageW={loaded.inspection.width}
                imageH={loaded.inspection.height}
                crop={item.preflight.crop}
                mode="crop"
                targetRatio={item.preflight.target.fullW / item.preflight.target.fullH}
                maxHeight={160}
              />
              <small className="muted">{item.loss < 0.005 ? "Nothing cropped" : `${pct}% cropped`}</small>
              {item.preflight.crop.axis !== "none" && (
                <input
                  className="slider" type="range" min={-1} max={1} step={0.01} aria-label={`Move the ${label} crop`}
                  value={offsets[item.profile.id] ?? 0}
                  onChange={(e) => setOffsets({ ...offsets, [item.profile.id]: Number(e.target.value) })}
                />
              )}
              {item.loss > 0.2 && (
                <label className="row" style={{ gap: 6, fontSize: "0.9rem" }}>
                  <input type="checkbox" checked={!!confirmed[item.profile.id]} onChange={(e) => setConfirmed({ ...confirmed, [item.profile.id]: e.target.checked })} />
                  This crop keeps what matters
                </label>
              )}
              <ul className="sizes">
                {item.sizes.map((s) => (
                  <li key={s.label} className={s.ok ? "check-ok" : "check-bad"}>
                    {s.ok ? "✓" : "⚠"} {s.label} {s.ok ? "" : "— may look soft"}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        {plan.pendingDecisions > 0 && (
          <p className="notice">
            {plan.pendingDecisions} {plan.pendingDecisions === 1 ? "shape crops" : "shapes crop"} away a lot of the artwork. Move the crop and tick the box to confirm.
          </p>
        )}
        {group.marketplace_constraints?.source.review_required && (
          <p className="notice">
            Etsy file limits used: up to {group.marketplace_constraints.max_files_per_listing} files, {formatBytes(group.marketplace_constraints.max_file_size_bytes)} each (last checked {group.marketplace_constraints.source.last_verified_at}; please confirm on Etsy&apos;s help page).
          </p>
        )}
        <button className="btn" onClick={generate} disabled={!!busy || plan.pendingDecisions > 0}>
          {busy ?? "Create pack"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {gen && (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="status READY_WITH_WARNINGS" role="status">
            <h3>✓ {gen.files.length} files created and verified</h3>
            <p>Each file was re-opened and checked. Upload {gen.uploads.length === 1 ? "this file" : `these ${gen.uploads.length} files`} to your Etsy listing:</p>
          </div>
          {gen.uploads.map((u) => (
            <div key={u.name} className="row">
              <a className="btn small" href={u.url} download={u.name}>Download {u.name}</a>
              <small className="muted">{formatBytes(u.bytes)}{u.contains.length > 1 ? ` · contains ${u.contains.length} files` : ""}</small>
            </div>
          ))}
          <a className="btn secondary small" href={gen.all.url} download={gen.all.name}>Download everything ({formatBytes(gen.all.bytes)})</a>
          <details className="advanced">
            <summary>File details</summary>
            <table className="kv"><tbody>
              {gen.files.map((f) => (
                <tr key={f.name}>
                  <td>{f.ratio}</td>
                  <td>
                    {f.name} · {f.verification.inspection?.width}×{f.verification.inspection?.height} · {formatBytes(f.bytes)}
                    <br /><span className="muted">{f.verification.label}</span>
                    {f.notes.map((n) => <div key={n} className="muted">{n}</div>)}
                  </td>
                </tr>
              ))}
            </tbody></table>
          </details>
        </div>
      )}
    </section>
  );
}
