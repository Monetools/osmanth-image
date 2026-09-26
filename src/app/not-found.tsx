import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="notfound">
      {/* A CSS background, not an <img>: Next wraps every page in the not-found boundary, so an <img>
          here would be preloaded on every page of the site. Decorative only. */}
      <div className="hero-art art-surprised" aria-hidden="true" />
      <h1>We couldn&apos;t find that page</h1>
      <p className="muted">It may have moved, or the address may have a typo.</p>
      <p>
        <a href="/" className="btn">
          Check an image
        </a>
      </p>
    </section>
  );
}
