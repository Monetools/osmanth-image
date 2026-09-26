import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NEVER_WORDS, findNeverWords } from "@/brandLanguage";
import { ENDORSEMENT, pageUrl, SITE_ORIGIN } from "@/site";
import { inspectImage } from "@/engine/inspect/inspect";
import { listGroups, buildCustomProfile } from "@/engine/profiles/registry";
import { runPreflight } from "@/engine/preflight/preflight";
import { planFix } from "@/engine/fix/planner";
import { setJpegPpi } from "@/engine/fix/metadata";
import { verifyOutput } from "@/engine/verify/verify";
import { parseHeaders, headersFor } from "../scripts/serve-out.mjs";
import { iccProfile, makeJpeg, makePng, SRGB_XYZ, WIDE_XYZ } from "./fixtures";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(join(root, p))).digest("hex");

/* ---------------------------------------------------------------- brand files */

describe("Brand Studio's files are used exactly as delivered", () => {
  it("every file in public/brand is byte-identical to design/brand", () => {
    const files = readdirSync(join(root, "public/brand"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(existsSync(join(root, "design/brand", f)), `${f} has no original`).toBe(true);
      expect(sha(`public/brand/${f}`), f).toBe(sha(`design/brand/${f}`));
    }
  });

  it("the token file is byte-identical to design/brand/tokens.css", () => {
    expect(sha("src/app/brand-tokens.css")).toBe(sha("design/brand/tokens.css"));
  });

  it("the shipped set covers what the pages reference", () => {
    const shipped = new Set(readdirSync(join(root, "public/brand")));
    for (const f of ["logo-primary.svg", "logo-reversed.svg", "logo-compact.svg", "expression-neutral.svg", "expression-thinking.svg",
      "expression-surprised.svg", "og.png", "favicon-16.png", "favicon-32.png", "favicon-180.png"]) {
      expect(shipped.has(f), f).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------- colours */

function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function blockAfter(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`no ${marker}`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced");
}
function resolve(v: string, all: Record<string, string>): string {
  const m = /^var\(--([\w-]+)\)$/.exec(v);
  return m ? resolve(all[m[1]], all) : v;
}
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = read("src/app/brand-tokens.css");
const css = read("src/app/globals.css");
function theme(dark: boolean): Record<string, string> {
  const t = vars(blockAfter(tokens, ":root {"));
  const g = vars(blockAfter(css, ":root {"));
  let all = { ...t, ...g };
  if (dark) {
    const tDark = vars(blockAfter(tokens, ':root:not([data-theme="light"])'));
    const gDark = vars(blockAfter(blockAfter(css, "@media (prefers-color-scheme: dark)"), ":root"));
    all = { ...all, ...tDark, ...gDark };
  }
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, resolve(v, all)]));
}

describe("colour: measured, not asserted", () => {
  for (const dark of [false, true]) {
    const t = theme(dark);
    const name = dark ? "dark" : "light";

    it(`${name}: the accent is the brand's own value`, () => {
      expect(t.accent).toBe(dark ? "#32a740" : "#15471b");
    });

    it(`${name}: text and links clear 4.5:1 on the surfaces they sit on`, () => {
      const pairs: [string, string, string][] = [
        ["text on page", t.text, t.bg],
        ["text on card", t.text, t.surface],
        ["muted on page", t.muted, t.bg],
        ["muted on card", t.muted, t.surface],
        ["muted on notice", t.muted, t["surface-2"]],
        ["accent link on page", t.accent, t.bg],
        ["accent link on card", t.accent, t.surface],
        ["accent link on notice", t.accent, t["surface-2"]],
        ["text on accent (buttons, step numbers)", t["on-accent"], t.accent],
        ["ok on ok-bg", t.ok, t["ok-bg"]],
        ["warn on warn-bg", t.warn, t["warn-bg"]],
        ["bad on bad-bg", t.bad, t["bad-bg"]],
        ["info on info-bg", t.info, t["info-bg"]],
        ["ok on card", t.ok, t.surface],
        ["warn on card", t.warn, t.surface],
        ["bad on card", t.bad, t.surface],
      ];
      const below = pairs.filter(([, fg, bg]) => ratio(fg, bg) < 4.5).map(([label, fg, bg]) => `${name}: ${label} ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
      expect(below).toEqual([]);
    });

    it(`${name}: controls and focus rings clear 3:1`, () => {
      expect(ratio(t.accent, t.bg), "accent border/focus on page").toBeGreaterThanOrEqual(3);
      expect(ratio(t["color-neutral-500"], t.bg), "input and drop-zone border on page").toBeGreaterThanOrEqual(3);
      expect(ratio(t["color-neutral-500"], t.surface), "input border on card").toBeGreaterThanOrEqual(3);
    });
  }

  it("the accent is never used by anything that reports a status", () => {
    // Brand rule: the accent never carries a status. Status has its own four colours.
    const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const statusSelector = /\.(status|tag|issue|cov|check-|counts|error)\b/;
    const brandVar = /var\(--(accent|on-accent|tint|color-brand[\w-]*)\)/;
    const offenders = rules.filter((r) => statusSelector.test(r.selector) && brandVar.test(r.body)).map((r) => r.selector);
    expect(offenders).toEqual([]);
    // And the reverse: the accent's own elements do not borrow a status colour.
    const accentSelector = /^(\.btn|\.step-num|\.skip-link)\b/;
    const borrowed = rules.filter((r) => accentSelector.test(r.selector) && /var\(--(ok|warn|bad|info)(-bg)?\)/.test(r.body)).map((r) => r.selector);
    expect(borrowed).toEqual([]);
  });

  it("every interactive control is at least 44px tall", () => {
    const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    for (const sel of [".btn", ".choice", 'select, input[type="number"]', 'input[type="range"]', "details.advanced summary"]) {
      const rule = rules.find((r) => r.selector === sel);
      expect(rule, `no rule for ${sel}`).toBeDefined();
      expect(rule!.body, sel).toMatch(/min-height:\s*(var\(--min-target\)|64px)/);
    }
    expect(tokens).toMatch(/--min-target:\s*44px/);
  });
});

/* ------------------------------------------------------------------ language */

describe("brand language (Brand Asset Kit, section 7)", () => {
  it("the scanner catches every banned word and spares Printful's product name", () => {
    expect(findNeverWords("The effective PPI is 300")).toEqual(["effective PPI"]);
    expect(findNeverWords("We upscale and enhance")).toEqual(["upscale / enhance"]);
    expect(findNeverWords("Your ICC profile / colour space")).toEqual(["ICC / colour space"]);
    expect(findNeverWords("Run preflight")).toEqual(["preflight"]);
    expect(findNeverWords("Add 3mm of bleed")).toEqual(["bleed"]);
    expect(findNeverWords("A raster bitmap")).toEqual(["raster / bitmap"]);
    expect(findNeverWords("Enhanced Matte Paper Poster — 12×18 in")).toEqual([]);
    expect(findNeverWords("300 PPI, 300 DPI, colours, extra edge")).toEqual([]);
    expect(NEVER_WORDS.length).toBe(6);
  });

  /** Every string a person can be shown for a spread of images and destinations. */
  function shownText(): string[] {
    const out: string[] = [];
    const imgs = [
      makeJpeg({ width: 4000, height: 3000, quality: 92 }),
      makeJpeg({ width: 900, height: 1125, quality: 40 }),
      makeJpeg({ width: 2400, height: 3000, noEoi: true }),
      makeJpeg({ width: 2400, height: 3000, components: 4, adobeTransform: 0 }),
      makeJpeg({ width: 2400, height: 3000, icc: iccProfile("RGB ", "sRGB IEC61966-2.1", WIDE_XYZ) }),
      makeJpeg({ width: 2400, height: 3000, icc: iccProfile("RGB ", "Adobe RGB (1998)") }),
      makeJpeg({ width: 2400, height: 3000, icc: iccProfile("RGB ", "Camera", SRGB_XYZ), iccChunks: 3, iccDropLastChunk: true }),
      makeJpeg({ width: 3000, height: 3000, jfifDpi: 72, exifOrientation: 6 }),
      makePng({ width: 2400, height: 3000, colorType: 6 }),
      makePng({ width: 1800, height: 2400, colorType: 0, bitDepth: 1 }),
    ];
    const profiles = [
      ...listGroups().flatMap((g) => g.profiles),
      buildCustomProfile({ width: 6, height: 9, unit: "in", bleed: { value: 0.125, unit: "in", sides: { top: true, bottom: true, inside: false, outside: true } } }),
      buildCustomProfile({ width: 210, height: 297, unit: "mm", bleed: { value: 3, unit: "mm" } }),
    ];
    for (const bytes of imgs) {
      const { inspection } = inspectImage(bytes, "sample.jpg");
      if (!inspection) continue;
      out.push(...inspection.warnings, ...inspection.structureProblems);
      for (const profile of profiles) {
        for (const alphaUsed of [true, false] as const) {
          const pre = runPreflight({ inspection, profile, alphaUsed, now: new Date("2026-09-24T00:00:00Z") });
          out.push(pre.summary.headline, pre.quality.headline, ...pre.quality.explanation, pre.trust.message);
          for (const i of pre.issues) out.push(i.title, i.detail);
          for (const c of pre.coverage) out.push(c.label, c.note);
          for (const [k, v] of Object.entries(pre.advanced)) out.push(k, v);
          const plan = planFix(inspection, profile, pre, { aspectMode: "crop", cropOffset: 0 });
          for (const s of plan.steps) out.push(s.label);
          const made = setJpegPpi(makeJpeg({ width: plan.spec.canvas.w, height: plan.spec.canvas.h }), plan.spec.ppi);
          if (plan.spec.format === "jpeg" && plan.spec.canvas.w * plan.spec.canvas.h < 5_000_000) {
            const v = verifyOutput(made, "o.jpg", profile, plan.spec, {
              outputAlphaUsed: false, source: { jpegQuality: 92, sharpness: null }, colorConverted: true, thresholds: pre.thresholds,
            });
            out.push(v.label, ...v.notes);
            for (const c of v.checks) out.push(c.name, c.expected, c.actual, c.note ?? "");
          }
        }
      }
    }
    return out;
  }

  it("nothing the engine can show a person uses a banned word", () => {
    const text = shownText();
    expect(text.length).toBeGreaterThan(5000);
    const bad = new Map<string, string>();
    for (const t of text) for (const w of findNeverWords(t)) if (!bad.has(t)) bad.set(t, w);
    expect([...bad].map(([t, w]) => `${w}: ${t.slice(0, 110)}`)).toEqual([]);
  });

  it("the SEO entrances and their copy are clean too", async () => {
    const { INTENTS } = await import("@/engine/intents");
    for (const i of INTENTS) for (const t of [i.title, i.h1, i.description, i.intro]) expect(findNeverWords(t), `${i.slug}: ${t}`).toEqual([]);
  });
});

/* -------------------------------------------------------------- site + headers */

describe("site identity and delivery", () => {
  it("the canonical address is www.osmanthimage.com, and pages get slash-terminated canonical URLs", () => {
    expect(SITE_ORIGIN).toBe("https://www.osmanthimage.com");
    expect(pageUrl("/")).toBe("https://www.osmanthimage.com/");
    expect(pageUrl("/8x10-photo-resolution")).toBe("https://www.osmanthimage.com/8x10-photo-resolution/");
    expect(pageUrl("privacy/")).toBe("https://www.osmanthimage.com/privacy/");
  });

  it("the endorsement is the exact wording the brand requires", () => {
    expect(ENDORSEMENT).toBe("An Osmanth product");
  });

  it("_headers forbids sending anything to another server, and stays within the host's line limit", () => {
    const text = read("public/_headers");
    const rules = parseHeaders(text);
    const h = headersFor(rules, "/8x10-photo-resolution/");
    const csp = h.get("Content-Security-Policy")!;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:\/\//); // no third-party origin is allowed anywhere
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headersFor(rules, "/_next/static/chunks/a.js").get("Cache-Control")).toContain("immutable");
    expect(headersFor(rules, "/brand/og.png").get("Cache-Control")).toBe("public, max-age=86400");
    // Cloudflare Pages rejects header lines longer than 2000 characters.
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(2000);
  });
});
