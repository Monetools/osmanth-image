import { SITE_NAME } from "@/site";

/**
 * The lockups come from Brand Studio and are used exactly as delivered — never recoloured, stretched
 * or redrawn. On a dark surface the primary lockup's wordmark and outline disappear, so the
 * reversed lockup (which carries its own dark field) takes over, as the kit prescribes.
 */
export function Logo({ where }: { where: "header" | "footer" }) {
  const isHeader = where === "header";
  const light = isHeader ? "/brand/logo-primary.svg" : "/brand/logo-compact.svg";
  const width = isHeader ? 526 : 312;
  const height = isHeader ? 140 : 72;

  const picture = (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/brand/logo-reversed.svg" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={light}
        width={width}
        height={height}
        alt={isHeader ? "" : SITE_NAME}
        className={isHeader ? undefined : "footer-logo"}
      />
    </picture>
  );

  if (!isHeader) return picture;
  return (
    <a href="/" className="logo" aria-label={`${SITE_NAME} — home`}>
      {picture}
    </a>
  );
}
