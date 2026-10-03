import { getProfile } from "@/engine/profiles/registry";
import { formatInches, pixelsFor, toInches } from "@/engine/units";

/**
 * "How many pixels does this print need?" for a page that is about one fixed size. Every number is
 * computed from that size's profile (inches x pixels per inch), so it cannot drift from what the
 * check itself uses. The pixels-per-inch figures are Osmanth Image's own guideline for the size, not
 * a printer requirement, and the copy says so.
 */
export function SizeAnswer({ profileId, guideHref }: { profileId: string; guideHref?: string }) {
  const p = getProfile(profileId);
  if (!p) return null;

  const wIn = toInches(p.size.width, p.size.unit);
  const hIn = toInches(p.size.height, p.size.unit);
  const dims = (ppi: number) => `${pixelsFor(wIn, ppi).toLocaleString("en-US")} × ${pixelsFor(hIn, ppi).toLocaleString("en-US")} px`;
  const inches = `${formatInches(wIn)} × ${formatInches(hIn)}`;
  const short = p.variant.replace(/\s*\(.*\)$/, "");

  return (
    <section className="explainer size-answer" aria-labelledby="size-answer">
      <h2 id="size-answer">Pixels needed for {p.variant}</h2>
      <p>
        {p.size.unit === "mm"
          ? `${short} is ${p.size.width} × ${p.size.height} mm, which is ${inches}. The pixels you need are the size in inches multiplied by the pixels per inch (PPI) you want.`
          : `For a print of ${inches}, the pixels you need are the size in inches multiplied by the pixels per inch (PPI) you want.`}
      </p>
      <div className="table-scroll" role="region" aria-label={`Pixels needed for ${p.variant}`} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">What it gives you</th>
              <th scope="col">Pixels per inch</th>
              <th scope="col">Pixels (portrait)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sharp at this size</td>
              <td>{p.ppi.preferred}</td>
              <td>{dims(p.ppi.preferred)}</td>
            </tr>
            <tr>
              <td>The least we call enough for normal viewing distance</td>
              <td>{p.ppi.minimum}</td>
              <td>{dims(p.ppi.minimum)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        These two figures are Osmanth Image&apos;s own guideline for this size, based on how far people usually stand from
        it. They are not a printer&apos;s requirement, and a printer may ask for more. Swap width and height for a
        landscape print. Below the lower figure the check tells you the print will look soft.
        {guideHref && (
          <>
            {" "}
            For other sizes, see <a href={guideHref}>poster size in pixels</a>.
          </>
        )}
      </p>
    </section>
  );
}
