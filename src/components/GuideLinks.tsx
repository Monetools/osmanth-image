import type { Guide } from "@/guides/frontmatter";

/**
 * Where tool pages and the home page point at guides (and guides at each other). Plain anchors, like
 * the rest of the site: each is a separate static page.
 */
function Items({ guides }: { guides: Guide[] }) {
  return (
    <ul className="guide-links">
      {guides.map((g) => (
        <li key={g.slug}>
          <a href={`/guides/${g.slug}/`}>{g.title}</a>
          <span>{g.description}</span>
        </li>
      ))}
    </ul>
  );
}

/** Bottom of a tool page: only the guides that belong to that tool. Renders nothing if there are none. */
export function ToolGuides({ guides }: { guides: Guide[] }) {
  if (!guides.length) return null;
  return (
    <section className="explainer guide-box" aria-labelledby="tool-guides">
      <h2 id="tool-guides">{guides.length === 1 ? "Guide" : "Guides"} for this check</h2>
      <Items guides={guides} />
    </section>
  );
}

/** Home page: the newest guides, and a way to the full list. */
export function GuidesTeaser({ guides }: { guides: Guide[] }) {
  if (!guides.length) return null;
  return (
    <section className="explainer guide-box" aria-labelledby="home-guides">
      <h2 id="home-guides">Guides</h2>
      <Items guides={guides} />
      <p>
        <a href="/guides/">All guides →</a>
      </p>
    </section>
  );
}

/** End of a guide: the other guides. */
export function MoreGuides({ guides }: { guides: Guide[] }) {
  if (!guides.length) return null;
  return (
    <section aria-labelledby="more-guides">
      <h2 id="more-guides">More guides</h2>
      <Items guides={guides} />
    </section>
  );
}
