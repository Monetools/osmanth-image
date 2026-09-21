#!/usr/bin/env node
/**
 * Record a MANUAL verification of a printer's published requirements.
 *
 * Some sources cannot be read automatically (Etsy, Printful and Printify all refuse our fetches).
 * This is how a person puts those rules on a trustworthy footing: open the official page, read it,
 * copy the exact sentences, optionally save a copy of the page into the repository, and record all
 * of that here. Automation can then only ever *lower* the resulting trust.
 *
 * Usage:
 *   node scripts/record-verification.mjs \
 *     --url https://help.etsy.com/... \
 *     --method human_page_read \
 *     --by "Jane" \
 *     --quote "You can upload up to five digital files, with a maximum size of 20MB each." \
 *     --supports marketplace.max_files_per_listing,marketplace.max_file_size_bytes \
 *     [--quote "..." --supports ...]        (repeatable: one --supports per --quote)
 *     [--archive path/to/saved-page.html]   (stored under src/engine/profiles/verifications/)
 *     [--due 2026-12-20]                    (explicit re-check date; default is per source type)
 *     [--date 2026-09-20]                   (verification date; default today)
 *     [--dry-run]
 *
 * It does NOT change any rule values. If the page says something different from what the profile
 * claims, edit the profile data first, in a separate, reviewable change.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyManualVerification, buildVerification, HUMAN_METHODS, validateVerification, VERIFICATION_METHODS } from "../src/engine/profiles/verification.ts";
import { normaliseText } from "./watch-sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dataDir = resolve(root, "src/engine/profiles/data");
const archiveDir = resolve(root, "src/engine/profiles/verifications");
const watchPath = resolve(dataDir, "source-watch.json");

function parseArgs(argv) {
  const out = { quotes: [], supports: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--url") out.url = next();
    else if (a === "--method") out.method = next();
    else if (a === "--by") out.by = next();
    else if (a === "--quote") out.quotes.push(next());
    else if (a === "--supports") out.supports.push(next());
    else if (a === "--archive") out.archive = next();
    else if (a === "--due") out.due = next();
    else if (a === "--date") out.date = next();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return out;
}

function usage() {
  console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
}

/** Every place in the profile data that cites this URL. */
export function findSources(groups, url) {
  const hits = [];
  for (const [file, group] of Object.entries(groups)) {
    for (const p of group.profiles ?? []) {
      if (p.source?.source_url === url) hits.push({ file, id: p.id, kind: "source", source: p.source });
      if (p.constraints_source?.source_url === url) hits.push({ file, id: p.id, kind: "constraints_source", source: p.constraints_source });
    }
    const mc = group.marketplace_constraints;
    if (mc?.source?.source_url === url) hits.push({ file, id: `${group.destination} marketplace`, kind: "marketplace", source: mc.source });
  }
  return hits;
}

function loadGroups() {
  const groups = {};
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith(".json") || file === "source-watch.json") continue;
    groups[file] = JSON.parse(readFileSync(resolve(dataDir, file), "utf8"));
  }
  return groups;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (!VERIFICATION_METHODS.includes(args.method) || args.method === "none" || args.method === "automated_fetch") {
    console.error(`--method must be one of: ${[...HUMAN_METHODS, "internal_policy"].join(", ")}`);
    process.exit(1);
  }
  if (!args.by) {
    console.error("--by is required: a verification must be attributable to a person.");
    process.exit(1);
  }
  if (args.quotes.length !== args.supports.length) {
    console.error("Each --quote needs exactly one --supports listing the fields it backs.");
    process.exit(1);
  }

  const date = args.date ?? new Date().toISOString().slice(0, 10);
  const evidence = args.quotes.map((quote, i) => ({
    quote,
    supports: args.supports[i].split(",").map((s) => s.trim()).filter(Boolean),
    archived_copy: null,
    archived_sha256: null,
  }));

  // An archived copy makes the claim checkable later, and gives the automated watch a baseline
  // hash even for pages it cannot fetch itself.
  let archivedText = null;
  if (args.archive) {
    const src = resolve(process.cwd(), args.archive);
    const raw = readFileSync(src);
    const stored = `${date}-${basename(src)}`;
    mkdirSync(archiveDir, { recursive: true });
    if (!args.dryRun) copyFileSync(src, resolve(archiveDir, stored));
    const sha = createHash("sha256").update(raw).digest("hex");
    for (const e of evidence) {
      e.archived_copy = `src/engine/profiles/verifications/${stored}`;
      e.archived_sha256 = sha;
    }
    archivedText = normaliseText(raw.toString("utf8"));
    console.log(`archived  ${stored}  sha256 ${sha.slice(0, 16)}…`);
  }

  const record = buildVerification({
    method: args.method,
    verifiedAt: date,
    verifiedBy: args.by,
    reviewDueAt: args.due ?? null,
    evidence,
  });

  const groups = loadGroups();
  const hits = findSources(groups, args.url);
  if (hits.length === 0) {
    console.error(`No profile cites ${args.url}. Check the URL against the profile data.`);
    process.exit(1);
  }

  for (const hit of hits) {
    validateVerification(`${hit.id} (${hit.kind})`, hit.source.source_type, date, record);
    // applyManualVerification returns a copy; write its trust fields back onto the live object.
    Object.assign(hit.source, applyManualVerification(hit.source, record));
    console.log(`${args.dryRun ? "would verify" : "verified"}  ${hit.id} (${hit.kind})`);
  }

  if (args.dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  for (const [file, group] of Object.entries(groups)) {
    writeFileSync(resolve(dataDir, file), `${JSON.stringify(group, null, 2)}\n`);
  }

  // Give the automated watch a baseline it can compare against later, without letting it claim the
  // verification as its own.
  if (archivedText) {
    const watch = JSON.parse(readFileSync(watchPath, "utf8"));
    const hash = createHash("sha256").update(archivedText).digest("hex");
    const entry = watch.sources.find((s) => s.url === args.url);
    if (entry) {
      entry.verifiedHash = hash;
      entry.baselineFrom = "manual-archive";
      entry.note = `Baseline taken from a copy archived by ${args.by} on ${date}.`;
      writeFileSync(watchPath, `${JSON.stringify(watch, null, 2)}\n`);
      console.log("watch baseline updated from the archived copy.");
    }
  }

  console.log(`\n${hits.length} source record(s) updated. Run 'npm test' and commit the change.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
