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
      </div>
      <div className="hero-art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/expression-neutral.svg" width="512" height="512" alt="" />
      </div>
    </section>
  );
}
