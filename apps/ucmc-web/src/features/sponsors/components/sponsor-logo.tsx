import { sponsorLogoUrl } from "#/features/sponsors/lib/logo-url";
import { cn } from "#/lib/utils";

/**
 * A sponsor's mark, in a fixed box.
 *
 * **Always on a light chip, in both themes.** A sponsor's logo is
 * supplied as-is and most are dark ink on an assumed white page; drop
 * one onto a dark card and the wordmark disappears. Painting a white
 * plate behind every mark is what print does for the same reason, and it
 * keeps a transparent PNG and an opaque JPEG looking like the same kind
 * of thing.
 *
 * **`alt=""`, deliberately.** The card always renders the sponsor's name
 * as visible text beside the mark, so the image carries no information a
 * screen reader isn't already given — an alt of the sponsor's name would
 * make it announce twice. That's also why `sponsors` has no `logo_alt`
 * column, unlike `album_photos`, where the image *is* the content.
 *
 * `object-contain` plus the stored intrinsic dimensions is the whole
 * point of the contain-not-crop upload path: a wide wordmark and a
 * square roundel each sit at their own aspect inside a shared box, and
 * the `width`/`height` attributes reserve the right ratio so the grid
 * doesn't reflow as logos decode.
 */
export function SponsorLogo({
  name,
  logoKey,
  widthPx,
  heightPx,
  className,
}: {
  name: string;
  logoKey: string | null;
  widthPx: number | null;
  heightPx: number | null;
  className?: string;
}) {
  const chip = cn(
    "flex h-24 w-full items-center justify-center rounded-md bg-white p-4 ring-1 ring-border/60",
    className,
  );

  // No mark on file — set the name instead of showing an empty plate, so
  // a sponsor added before anyone chased down a usable logo still reads
  // as a deliberate entry rather than a broken image.
  if (!logoKey) {
    return (
      <div className={chip}>
        <span className="text-center text-sm font-semibold leading-tight text-neutral-700">
          {name}
        </span>
      </div>
    );
  }

  return (
    <div className={chip}>
      <img
        src={sponsorLogoUrl(logoKey)}
        alt=""
        width={widthPx ?? undefined}
        height={heightPx ?? undefined}
        loading="lazy"
        decoding="async"
        className="max-h-full w-auto max-w-full object-contain"
      />
    </div>
  );
}
