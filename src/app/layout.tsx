import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { INTENTS } from "@/engine/intents";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "PrintReady — tell us where you're printing, we'll prepare the file", template: "%s | PrintReady" },
  description: "Check whether an image will print well at the size you want, fix what can be fixed, and download a verified print-ready file. Free, in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand">Print<span>Ready</span></Link>
            <span className="tagline">Tell us where you&apos;re printing. We&apos;ll prepare the file.</span>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <p>Your images are checked and prepared in your browser. They are not uploaded unless you choose AI enlargement, and are never used for training.</p>
            <nav aria-label="Tools">
              {INTENTS.map((i) => <Link key={i.slug} href={`/${i.slug}`}>{i.h1}</Link>)}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
