import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MoreGuides } from "@/components/GuideLinks";
import { JsonLd } from "@/components/JsonLd";
import { allGuides, getGuide, relatedGuides } from "@/guides/guides";
import { Markdown } from "@/guides/markdown";
import { guideJsonLd, pageMetadata } from "@/seo";

// A guide is a file in content/guides/. Unknown slugs are a real 404, not a blank page.
export const dynamicParams = false;

export function generateStaticParams() {
  return allGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = getGuide((await params).slug);
  if (!g) return {};
  return pageMetadata({ path: `guides/${g.slug}`, title: g.metaTitle, description: g.description, type: "article" });
}

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = getGuide((await params).slug);
  if (!g) notFound();
  return (
    <article className="prose guide">
      <JsonLd data={guideJsonLd(g)} />
      <nav aria-label="Breadcrumb" className="crumbs">
        <ol>
          <li><a href="/">Home</a></li>
          <li><a href="/guides/">Guides</a></li>
          <li aria-current="page">{g.metaTitle}</li>
        </ol>
      </nav>
      <h1>{g.title}</h1>
      <p className="guide-meta">
        Published {fmt(g.date)}
        {g.updated !== g.date && <> · Updated {fmt(g.updated)}</>}
      </p>

      <Markdown source={g.body} />

      <aside className="guide-cta" aria-labelledby="guide-cta-title">
        <h2 id="guide-cta-title">Try it on your own image</h2>
        <p>The check is free and runs on your device. Your image is not uploaded.</p>
        <a className="btn" href={g.toolCta}>{g.ctaText}</a>
      </aside>

      <section aria-labelledby="guide-sources">
        <h2 id="guide-sources">Sources</h2>
        <p>Printers and marketplaces change their rules. Each page below was read on the date shown; check it again before you rely on it.</p>
        <ul>
          {g.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a> — read {fmt(s.checked)}
            </li>
          ))}
        </ul>
      </section>

      <MoreGuides guides={relatedGuides(g.slug)} />
    </article>
  );
}
