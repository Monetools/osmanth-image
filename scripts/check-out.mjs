#!/usr/bin/env node
/**
 * Post-build check of the static export (`out/`). Runs automatically after `npm run build`.
 *
 * It looks at what will actually be served, because that is where launch mistakes hide: a
 * localhost canonical, a page missing the endorsement, a sitemap URL with no page behind it.
 * Exit code 1 lists every failure.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findNeverWords } from "../src/brandLanguage.ts";
import { INTENTS } from "../src/engine/intents.ts";
import { ENDORSEMENT, SITE_NAME, SITE_ORIGIN } from "../src/site.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

if (!existsSync(out)) {
  console.error("out/ not found. Run `npm run build` first.");
  process.exit(1);
}

const read = (p) => readFileSync(join(out, p), "utf8");
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const attrs = (tag) => {
  const o = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)=(?:"([^"]*)"|'([^']*)')/g)) o[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? "");
  return o;
};
const meta = (html, key, val) => tags(html, "meta").map(attrs).find((a) => a[key] === val)?.content;
const visibleText = (html) =>
  decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

// ------------------------------------------------------------------ pages that must exist
const pages = [
  { file: "index.html", path: "/" },
  ...INTENTS.map((i) => ({ file: `${i.slug}/index.html`, path: `/${i.slug}/` })),
  { file: "privacy/index.html", path: "/privacy/" },
];

for (const p of pages) {
  if (!existsSync(join(out, p.file))) {
    fail(p.file, "page was not generated");
    continue;
  }
  const html = read(p.file);
  const where = p.file;
  const expected = `${SITE_ORIGIN}${p.path}`;

  const canonical = tags(html, "link").map(attrs).find((a) => a.rel === "canonical")?.href;
  if (canonical !== expected) fail(where, `canonical is ${canonical ?? "missing"}, expected ${expected}`);

  const title = decode(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  if (!title) fail(where, "no <title>");
  else if (!title.includes(SITE_NAME)) fail(where, `title does not name the product: "${title}"`);
  if (title.length > 70) fail(where, `title is ${title.length} characters (keep it under about 70): "${title}"`);

  const description = meta(html, "name", "description");
  if (!description) fail(where, "no meta description");
  else if (description.length > 175) fail(where, `meta description is ${description.length} characters (keep it under about 160)`);

  if (meta(html, "property", "og:url") !== expected) fail(where, `og:url should be ${expected}`);
  const ogImage = meta(html, "property", "og:image");
  if (!ogImage || !ogImage.startsWith("https://") || !ogImage.endsWith("/brand/og.png")) fail(where, `og:image should be an absolute https URL to /brand/og.png (got ${ogImage})`);
  if (meta(html, "name", "twitter:card") !== "summary_large_image") fail(where, "twitter:card should be summary_large_image");

  const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1s !== 1) fail(where, `expected exactly one <h1>, found ${h1s}`);

  const text = visibleText(html);
  if (!text.includes(ENDORSEMENT)) fail(where, `missing the endorsement "${ENDORSEMENT}"`);
  if (!tags(html, "a").map(attrs).some((a) => a.href === "https://checkbeforesubmit.com/")) fail(where, "no link to Check Before Submit");
  for (const bad of [/localhost/i, /PrintReady/, /AI enlargement/i, /\/api\//]) {
    if (bad.test(html)) fail(where, `contains ${bad}`);
  }
  const words = findNeverWords(text);
  if (words.length) fail(where, `brand language: uses ${words.join(", ")}`);

  // JSON-LD must parse and point at this page.
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (p.file !== "privacy/index.html") {
    if (ld.length !== 1) fail(where, `expected one JSON-LD block, found ${ld.length}`);
    else {
      try {
        const d = JSON.parse(ld[0]);
        if (d.url !== expected) fail(where, `JSON-LD url is ${d.url}`);
      } catch {
        fail(where, "JSON-LD does not parse");
      }
    }
  }
}

// --------------------------------------------------------------------- 404 page
if (!existsSync(join(out, "404.html"))) fail("404.html", "not generated");
else if (!/noindex/i.test(read("404.html"))) fail("404.html", "should be noindex");

// ------------------------------------------------------------ sitemap and robots
if (!existsSync(join(out, "sitemap.xml"))) fail("sitemap.xml", "not generated");
else {
  const urls = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const wanted = pages.map((p) => `${SITE_ORIGIN}${p.path}`);
  for (const u of wanted) if (!urls.includes(u)) fail("sitemap.xml", `missing ${u}`);
  for (const u of urls) if (!wanted.includes(u)) fail("sitemap.xml", `lists ${u}, which is not a page`);
}
if (!existsSync(join(out, "robots.txt"))) fail("robots.txt", "not generated");
else if (!read("robots.txt").includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)) fail("robots.txt", "does not point at the sitemap");

// -------------------------------------------------------------- headers / privacy
if (!existsSync(join(out, "_headers"))) fail("_headers", "not copied to out/");
else {
  const h = read("_headers");
  for (const need of ["Content-Security-Policy:", "connect-src 'self'", "form-action 'none'", "frame-ancestors 'none'", "X-Content-Type-Options: nosniff"]) {
    if (!h.includes(need)) fail("_headers", `missing ${need}`);
  }
}

// ---------------------------------------------------- brand files are Brand Studio's, untouched
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const brandDir = join(out, "brand");
if (!existsSync(brandDir)) fail("brand/", "not copied to out/");
else {
  for (const f of readdirSync(brandDir)) {
    const source = join(root, "design", "brand", f);
    if (!existsSync(source)) fail(`brand/${f}`, "has no original in design/brand/");
    else if (sha(source) !== sha(join(brandDir, f))) fail(`brand/${f}`, "differs from design/brand/ — brand files must not be edited");
  }
}

// ------------------------------------------------------------------------ report
let bytes = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else bytes += statSync(p).size;
  }
};
walk(out);

if (failures.length) {
  console.error(`\nSite check FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Site check passed: ${pages.length} pages, sitemap, robots, headers, brand files. out/ is ${(bytes / 1048576).toFixed(1)} MB (${relative(root, out)}).`);
