/**
 * Page opening. The character is Brand Studio's neutral expression, decorative only (alt=""), sitting
 * on the family's warm tint so its outline stays visible in both light and dark themes.
 */
export function Hero({ title, lede, chips = true }: { title: string; lede: string; chips?: boolean }) {
  return (
    <section className="hero">
      <div>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {chips && (
          <ul className="chips" aria-label="At a glance">
            <li>Free</li>
            <li>Stays on your device</li>
            <li>JPEG · PNG · WebP</li>
          </ul>
        )}
        {/* The upload step sits right after this section on every page (see src/app/page.tsx and
            src/app/[slug]/page.tsx). On a phone the hero fills the first screen, so this jump link
            gets a returning or task-focused visitor to it without scrolling past the copy first. */}
        <a className="hero-jump" href="#s1">Start with your image ↓</a>
      </div>
      <div className="hero-art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/expression-neutral.svg" width="512" height="512" alt="" />
      </div>
    </section>
  );
}
