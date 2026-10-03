import { Fragment, type ReactNode } from "react";
import { GuideError } from "./frontmatter";

/**
 * A deliberately small Markdown subset, rendered to React elements (never to raw HTML), so a guide can
 * only contain what the site's design already styles:
 *
 *   ## Heading   ### Subheading        paragraphs        - bullet lists       1. numbered lists
 *   > quotation  | tables |            **bold**  *italic*  `code`  [text](/site-path/ or https://...)
 *
 * The page title is the <h1>, so the body starts at ##. Anything else is a build error, not silently
 * dropped text.
 */

export type Block =
  | { t: "h2" | "h3"; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; rows: string[][]; label: string };

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isTableSep = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let heading = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1] === "#") throw new GuideError(`the page title is the only <h1>; use ## in the body ("${h[2]}")`);
      if (h[1].length > 3) throw new GuideError(`headings go no deeper than ### ("${h[2]}")`);
      heading = h[2].trim();
      blocks.push({ t: h[1].length === 2 ? "h2" : "h3", text: heading });
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const row = cells(lines[i]);
        if (row.length !== head.length) throw new GuideError(`table row "${lines[i]}" has ${row.length} cells, the header has ${head.length}`);
        rows.push(row);
        i++;
      }
      blocks.push({ t: "table", head, rows, label: heading || "Table" });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      const marker = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      while (i < lines.length && marker.test(lines[i])) {
        items.push(marker.exec(lines[i])![1].trim());
        i++;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^>\s?/, "").trim());
        i++;
      }
      blocks.push({ t: "quote", text: parts.join(" ") });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|\s*\|)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (!para.length) throw new GuideError(`cannot read line "${line}"`);
    blocks.push({ t: "p", text: para.join(" ") });
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g;
const SAFE_HREF = /^(\/[A-Za-z0-9\-_/#.?=&%]*|https:\/\/[^\s)]+)$/;

export function linksIn(text: string): string[] {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
}

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)!;
      if (!SAFE_HREF.test(m[2])) throw new GuideError(`link "${m[2]}" must be a site path or an https:// address`);
      // Plain anchors, like the rest of the site (see SiteFooter): these are separate static pages.
      return m[2].startsWith("/") ? (
        <a key={i} href={m[2]}>{m[1]}</a>
      ) : (
        <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>
      );
    }
    if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((b, i) => {
        switch (b.t) {
          case "h2": return <h2 key={i}>{inline(b.text)}</h2>;
          case "h3": return <h3 key={i}>{inline(b.text)}</h3>;
          case "p": return <p key={i}>{inline(b.text)}</p>;
          case "quote": return <blockquote key={i}><p>{inline(b.text)}</p></blockquote>;
          case "ul": return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>;
          case "ol": return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>;
          case "table":
            return (
              // Wide tables scroll inside their own box instead of making the whole page scroll sideways.
              <div key={i} className="table-scroll" role="region" aria-label={b.label} tabIndex={0}>
                <table>
                  <thead><tr>{b.head.map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
