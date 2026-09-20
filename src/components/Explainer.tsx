export function Explainer() {
  return (
    <section className="explainer">
      <h2>How PrintReady decides</h2>
      <p>
        Print quality depends on how many pixels cover each inch of paper. We measure that from the real pixels in your
        file and the size you want — the &ldquo;DPI&rdquo; number stored in a file doesn&apos;t change quality, so we
        never rely on it.
      </p>
      <p>
        Bigger prints are seen from further away, so a poster needs fewer pixels per inch than a small photo. We also look
        at compression and colour, and we never stretch your image: if the shape doesn&apos;t match, you choose how to crop.
      </p>
      <p>
        When the file is ready we open the finished file again and check it against the printer&apos;s requirements before
        calling it ready.
      </p>
    </section>
  );
}
