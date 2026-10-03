import { JsonLd } from "@/components/JsonLd";
import { allGuides } from "@/guides/guides";
import { guidesIndexJsonLd, pageMetadata } from "@/seo";

const DESCRIPTION =
  "Plain-language guides to print sizes, pixels and file limits. Each ends with a free check you can run on your own image.";

export const metadata = pageMetadata({ path: "guides", title: "Guides", description: DESCRIPTION });

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export default function GuidesIndex() {
  const guides = allGuides();
  return (
    <div className="prose guide-index">
      <JsonLd data={guidesIndexJsonLd(DESCRIPTION)} />
      <h1>Guides</h1>
      <p>
        Short answers to the questions people ask before they print: which size, how many pixels, which limits apply. Each
        guide names its sources and ends with the free check for your own image, which runs on your device.
      </p>
      <ul className="guide-list">
        {guides.map((g) => (
          <li key={g.slug}>
            <h2>
              <a href={`/guides/${g.slug}/`}>{g.title}</a>
            </h2>
            <p>{g.description}</p>
            <p className="guide-meta">Updated {fmt(g.updated)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
