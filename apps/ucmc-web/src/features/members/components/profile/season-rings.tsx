/**
 * The member's avatar, ringed once per season they have finished,
 * with an arc for the season they are in.
 *
 * Read it like a cross-cut trunk: a ring is a year served. A member
 * in their first season has none yet — only the arc, filling from the
 * day they attested toward May 1, when it closes into a ring (see
 * `season-progress.ts`). Someone a quarter of the way into their
 * third season shows two rings and a quarter arc.
 *
 * Rings grow OUTWARD from the avatar: the first season sits against
 * the photo and each one after it pushes further out, with the
 * in-progress arc beyond the lot. The box is sized for the maximum,
 * so the header never reflows as a member accrues years — a
 * first-year's rings simply sit tighter in.
 */
import { UserAvatar } from "#/components/user-avatar";
import { cn } from "#/lib/utils";

/**
 * Five, matching the tenure ladder: Redbud through White Oak, where
 * the fifth badge is "five seasons or more". Past that the rings
 * would stop being countable and start being hatching, and the
 * ladder has nothing further to say anyway.
 */
const MAX_DRAWN_RINGS = 5;

const BOX = 100;
/** Radius of the avatar's edge; the first ring sits just outside it. */
const AVATAR_EDGE = 29;
const RING_GAP = 3.2;
const STROKE = 2.2;

export interface SeasonRingsProps {
  avatarKey: string | null;
  name: string | null;
  /** Closed rings: seasons finished. */
  completedSeasons: number;
  /** `[0, 1]` for a season under way, or `null` when none is. */
  seasonProgress: number | null;
  className?: string;
}

export function SeasonRings({
  avatarKey,
  name,
  completedSeasons,
  seasonProgress,
  className,
}: SeasonRingsProps) {
  const drawn = Math.min(completedSeasons, MAX_DRAWN_RINGS);
  // Rings grow OUTWARD: the first season sits against the avatar and
  // each one after it pushes further out, so the ring stack reads as
  // accumulation and tenure is legible across a row of profiles
  // without counting. The in-progress arc is the next ring out — the
  // shape the season is working toward.
  //
  // The box is sized for the maximum, so nothing reflows as a member
  // accrues seasons; a first-year's rings just sit tighter in.
  const ringRadius = (i: number) => AVATAR_EDGE + (i + 1) * RING_GAP;
  const arcRadius = AVATAR_EDGE + (drawn + 1) * RING_GAP;

  const circumference = 2 * Math.PI * arcRadius;
  const hasArc = seasonProgress !== null && seasonProgress > 0;

  const seasonLabel =
    completedSeasons === 1 ? "1 season" : `${completedSeasons} seasons`;

  return (
    <div
      className={cn("relative aspect-square w-24 shrink-0 sm:w-32", className)}
    >
      <svg
        viewBox={`0 0 ${BOX} ${BOX}`}
        className="absolute inset-0 size-full"
        role="img"
        aria-label={
          hasArc
            ? `${seasonLabel} completed, currently part way through another`
            : `${seasonLabel} completed`
        }
      >
        {Array.from({ length: drawn }, (_, i) => (
          <circle
            key={i}
            cx={BOX / 2}
            cy={BOX / 2}
            r={ringRadius(i)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={STROKE}
            // Faintest at the centre, strongest at the edge, so the
            // eye travels outward with the years rather than landing
            // on the middle like a target.
            strokeOpacity={0.4 + (0.6 * (i + 1)) / drawn}
          />
        ))}

        {hasArc ? (
          // No track behind the arc. A full grey circle reads as a
          // closed ring the member has not earned, which is exactly
          // the thing the ring count is supposed to tell them — so
          // the unfilled part of the season is simply absent.
          <circle
            cx={BOX / 2}
            cy={BOX / 2}
            r={arcRadius}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - seasonProgress)}
            // Start at twelve o'clock and run clockwise; the SVG
            // default starts at three and runs anticlockwise, which
            // reads as counting down.
            transform={`rotate(-90 ${BOX / 2} ${BOX / 2})`}
          />
        ) : null}
      </svg>

      {/* Fixed inset matching `AVATAR_EDGE`, so the avatar is the same
          size on every profile however many seasons ring it. */}
      <UserAvatar
        avatarKey={avatarKey}
        name={name}
        className="absolute inset-[21%] size-auto"
        fallbackClassName="text-lg sm:text-2xl"
      />
    </div>
  );
}
