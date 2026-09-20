#!/usr/bin/env node
/**
 * Source watch for Print Profiles.
 *
 * Fetches every `source_url` referenced by the profile data, normalises the page text, and compares
 * a sha256 against the hash recorded when a human last verified the rules.
 *
 *   node scripts/watch-sources.mjs             check only; a change is flagged "changed-needs-review"
 *   node scripts/watch-sources.mjs --accept    a human has re-read the pages and the profiles;
 *                                              record the current text as verified
 *
 * It NEVER edits the profile JSON. A detected change only sets a watch status, which
 * `effectiveFreshness()` turns into "needs review" at read time. Snapshots of the fetched text are
 * written next to the data so a human can diff what actually changed.
 *
 * Exit code: 0 = every source unchanged, 2 = at least one change or fetch failure.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../src/engine/profiles/data");
const snapDir = resolve(here, "../src/engine/profiles/snapshots");
const watchPath = resolve(dataDir, "source-watch.json");
const accept = process.argv.includes("--accept");
const TIMEOUT_MS = 20_000;

/** Strip markup and page chrome so a hash only changes when the wording does. */
export function normaliseText(html) {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  return main
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|p|li|h[1-6]|div|tr|td)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t\r\f\v]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function slug(url) {
  return url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function collectSources() {
  const urls = new Map();
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith(".json") || file === "source-watch.json") continue;
    const group = JSON.parse(readFileSync(resolve(dataDir, file), "utf8"));
    const add = (src, where) => {
      if (!src?.source_url || src.source_type === "user_supplied") return;
      if (!urls.has(src.source_url)) urls.set(src.source_url, new Set());
      urls.get(src.source_url).add(where);
    };
    for (const p of group.profiles ?? []) {
      add(p.source, p.id);
      add(p.constraints_source, `${p.id} (constraints)`);
    }
    add(group.marketplace_constraints?.source, `${group.destination} marketplace`);
  }
  return urls;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = collectSources();
  const previous = JSON.parse(readFileSync(watchPath, "utf8"));
  const byUrl = new Map(previous.sources.map((s) => [s.url, s]));
  mkdirSync(snapDir, { recursive: true });

  const out = [];
  let problems = 0;
  for (const [url, users] of urls) {
    const prev = byUrl.get(url) ?? { url, verifiedHash: null, lastSeenHash: null, lastChecked: null, lastChanged: null, status: "never-checked" };
    const entry = { ...prev, url, usedBy: [...users].sort() };
    let text = null;
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = normaliseText(await res.text());
    } catch (err) {
      entry.status = "fetch-failed";
      entry.lastChecked = today;
      entry.note = `Could not fetch: ${err.message}. Freshness cannot be confirmed automatically; a human must check this page.`;
      problems++;
      out.push(entry);
      console.log(`FETCH-FAILED  ${url} — ${err.message}`);
      continue;
    }
    const hash = createHash("sha256").update(text).digest("hex");
    writeFileSync(resolve(snapDir, `${slug(url)}.txt`), text);
    entry.lastChecked = today;
    entry.lastSeenHash = hash;
    delete entry.note;
    if (accept) {
      entry.verifiedHash = hash;
      entry.status = "unchanged";
      console.log(`ACCEPTED      ${url}`);
    } else if (entry.verifiedHash && entry.verifiedHash !== hash) {
      entry.status = "changed-needs-review";
      entry.lastChanged = today;
      problems++;
      console.log(`CHANGED       ${url} — review the snapshot, then update the profile and re-run with --accept`);
    } else if (!entry.verifiedHash) {
      entry.status = "never-checked";
      console.log(`NEW           ${url} — snapshot written; a human must verify the rules, then run with --accept`);
    } else {
      entry.status = "unchanged";
      console.log(`unchanged     ${url}`);
    }
    out.push(entry);
  }
  writeFileSync(watchPath, `${JSON.stringify({ updatedAt: today, sources: out }, null, 2)}\n`);
  console.log(`\n${out.length} source(s) checked; ${problems} need attention.`);
  process.exit(problems ? 2 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await main();
}
