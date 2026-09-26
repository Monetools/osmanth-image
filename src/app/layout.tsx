import type { Metadata, Viewport } from "next";
import "./brand-tokens.css";
import "./globals.css";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";
import { DESCRIPTION, SIBLING, SITE_NAME, SITE_ORIGIN, TAGLINE } from "@/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: `${SITE_NAME} — ${TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  // Favicons are Brand Studio's pre-rendered PNGs from the same mark as every other asset.
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/brand/favicon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to the tool
        </a>
        <header className="site-header">
          <div className="wrap">
            <Logo where="header" />
            <p className="header-note">
              Have a PDF?{" "}
              <a href={SIBLING.href} target="_blank" rel="noopener">
                {SIBLING.name} →
              </a>
            </p>
          </div>
        </header>
        <main id="main" className="wrap">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
