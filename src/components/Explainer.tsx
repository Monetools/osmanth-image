import { SIBLING } from "@/site";

export function Explainer() {
  return (
    <section className="explainer">
      <h2>How the check works</h2>
      <p>
        Print quality depends on how many pixels cover each inch of paper. We measure that from the real pixels in your
        image and the size you want. The &ldquo;DPI&rdquo; number saved inside a file doesn&apos;t change quality, so we
        never rely on it.
      </p>
      <p>
        Bigger prints are seen from further away, so a poster needs fewer pixels per inch than a small photo. We also look
        at how the image was saved and at its colours, and we never stretch your image: if the shape doesn&apos;t match,
        you choose how to crop.
      </p>
      <p>
        We don&apos;t invent pixels. If an image doesn&apos;t have enough for the size you picked, we tell you how big it
        prints well instead.
      </p>
      <p>
        When your file is ready, we open the finished file again and check it before we call it ready. Printers change
        their requirements, so where we couldn&apos;t confirm a printer&apos;s own page, we say so instead of guessing.
      </p>
      <p>
        Working with a PDF? That&apos;s{" "}
        <a href={SIBLING.href} target="_blank" rel="noopener">
          {SIBLING.name}
        </a>
        , which checks page size, fonts, colours and more.
      </p>
    </section>
  );
}
