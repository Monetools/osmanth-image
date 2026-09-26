import { pageMetadata } from "@/seo";
import { SIBLING } from "@/site";

export const metadata = pageMetadata({
  path: "privacy",
  title: "Privacy",
  description: "Osmanth Image checks and prepares your image on your own device. Nothing is uploaded. No cookies, no tracking.",
});

export default function Privacy() {
  return (
    <div className="prose">
      <h1>Privacy</h1>
      <p>
        Osmanth Image is built so that your images never need to leave your device. This page says exactly what that
        means.
      </p>

      <h2>Your images</h2>
      <ul>
        <li>Your image is opened, checked and prepared by your own browser. It is not uploaded to us or to anyone else.</li>
        <li>The file you download is created on your device.</li>
        <li>We don&apos;t keep your images, because we never receive them.</li>
      </ul>

      <h2>What this site does not do</h2>
      <ul>
        <li>It sets no cookies.</li>
        <li>It uses no analytics, advertising or tracking scripts.</li>
        <li>It stores nothing in your browser between visits.</li>
        <li>It loads nothing from other websites.</li>
      </ul>

      <h2>What the host may see</h2>
      <p>
        Like any website, the service that delivers these pages to you may keep standard server logs, such as the
        address you connected from and which pages were requested. Those logs contain no part of your images.
      </p>

      <h2>Other sites</h2>
      <p>
        We link to printers&apos; own requirement pages and to{" "}
        <a href={SIBLING.href} target="_blank" rel="noopener">
          {SIBLING.name}
        </a>
        , which checks PDFs. Those are separate sites with their own privacy practices.
      </p>
    </div>
  );
}
