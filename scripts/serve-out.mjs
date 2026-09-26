#!/usr/bin/env node
/**
 * Serve the static export (`out/`) the way the real host will: the same `_headers` rules, the same
 * `/name/` -> `/name/index.html` resolution, and `404.html` for anything missing.
 *
 *   npm run preview           build, then serve on http://localhost:4173
 *   PORT=5000 node scripts/serve-out.mjs
 *
 * This exists so the Content-Security-Policy is exercised against the real pages before launch. If
 * the policy were too strict, the browser console would show violations here.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

/** Parse `_headers`: a path pattern line, then indented `Name: value` lines. */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      const i = raw.indexOf(":");
      if (current && i > 0) current.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
    } else {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
    }
  }
  return rules;
}

function matches(pattern, path) {
  const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(path);
}

export function headersFor(rules, path) {
  const out = new Map();
  for (const r of rules) if (matches(r.pattern, path)) for (const [k, v] of r.headers) out.set(k, v);
  return out;
}

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const full = join(root, clean);
  if (!full.startsWith(root + sep) && full !== root) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  const index = join(full, "index.html");
  if (existsSync(index)) return index;
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!existsSync(root)) {
    console.error("out/ does not exist. Run `npm run build` first.");
    process.exit(1);
  }
  const rules = existsSync(join(root, "_headers")) ? parseHeaders(readFileSync(join(root, "_headers"), "utf8")) : [];
  createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Like Cloudflare Pages: a directory without a trailing slash redirects to the slashed URL.
    let file = resolveFile(url.pathname);
    if (file && file.endsWith("index.html") && !url.pathname.endsWith("/") && !extname(url.pathname)) {
      res.writeHead(308, { Location: url.pathname + "/" + url.search });
      return res.end();
    }
    let status = 200;
    if (!file) {
      status = 404;
      file = join(root, "404.html");
    }
    const headers = { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" };
    for (const [k, v] of headersFor(rules, url.pathname)) headers[k] = v;
    res.writeHead(status, headers);
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`serving out/ with _headers on http://localhost:${port}`));
}
