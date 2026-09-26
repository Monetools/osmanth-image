import { INTENTS } from "@/engine/intents";
import { ENDORSEMENT, SIBLING } from "@/site";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      {/* Plain links, not next/link: Next 16.3.5's static export writes its prefetch payloads where its own
          client does not look for them (every prefetch 404s). These are separate static pages, so a normal
          navigation is the robust choice and behaves identically on any static host. */}
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo where="footer" />
            {/* Brand rule: this exact wording, on every page. Not a link — the parent site is not live yet. */}
            <p className="endorse">{ENDORSEMENT}</p>
            <p className="footer-note">
              Printers change their requirements. Where we couldn&apos;t confirm a printer&apos;s own page, the check tells you so.
            </p>
          </div>

          <nav aria-label="Tools" className="footer-tools">
            <h2>Tools</h2>
            <ul className="link-list cols">
              {INTENTS.map((i) => (
                <li key={i.slug}>
                  <a href={`/${i.slug}/`}>{i.h1}</a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="More" className="footer-more">
            <h2>More</h2>
            <ul className="link-list">
              <li>
                <a href={SIBLING.href} target="_blank" rel="noopener">
                  Check a PDF — {SIBLING.name}
                </a>
              </li>
              <li>
                <a href="/privacy/">Privacy</a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
