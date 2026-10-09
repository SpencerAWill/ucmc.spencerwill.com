/**
 * A member's badges, and the ones still out there.
 *
 * The catalog shows **everything**, earned or not, which is the
 * decision worth defending: a grid of only what someone has already
 * collected has nothing to chase, and on a new member's profile it
 * is empty. Unearned badges render drained and dashed, and a badge
 * whose data source does not exist yet says so in as many words
 * rather than pretending to be merely unearned.
 *
 * Hidden badges are the one exception — they are omitted until
 * earned, so there is something to stumble on.
 */
import { BadgeEmblem } from "#/components/badge-emblem";
import { Card, CardContent } from "#/components/ui/card";
import type {
  AwardedBadge,
  BadgeKey,
} from "#/server/member-profile/badge-registry";
import {
  BADGES,
  BADGE_BLOCKERS,
  BADGE_KEYS,
  BADGE_KINDS,
  BADGE_KIND_LABELS,
} from "#/server/member-profile/badge-registry";
import { showcaseBadges } from "#/server/member-profile/badge-rules";
import { cn } from "#/lib/utils";

/** How many badges the compact summary shows before linking onward. */
const SHOWCASE_LIMIT = 4;

function BadgeTile({
  badgeKey,
  award,
  showDetail,
}: {
  badgeKey: BadgeKey;
  award: AwardedBadge | undefined;
  /**
   * Render the explanation as text under the label.
   *
   * **The catalog does; the showcase does not.** This used to be a
   * tooltip, which is unreachable in the two places that matter
   * most: a `<figure>` takes no focus, so a keyboard never reaches
   * it, and Radix tooltips do not open on touch — leaving a phone
   * reader a grid of drained, dashed badges with nothing anywhere
   * saying why. On a mobile-first page that is the whole
   * explanation missing.
   */
  showDetail: boolean;
}) {
  const badge = BADGES[badgeKey];
  const earned = award !== undefined;
  const blocker = badge.blockedBy;

  const detail = earned
    ? award.count !== null
      ? `${badge.description} · ${award.count}`
      : badge.description
    : blocker
      ? BADGE_BLOCKERS[blocker]
      : badge.description;

  return (
    <figure className="flex flex-col items-center gap-1.5 text-center">
      <BadgeEmblem
        art={badge.art}
        shape={badge.shape}
        tier={award?.tier ?? null}
        locked={!earned}
        className="size-14 sm:size-16"
      />
      <figcaption
        className={cn(
          "text-xs leading-tight font-medium",
          !earned && "text-muted-foreground",
        )}
      >
        {badge.label}
        {showDetail ? (
          <span className="mt-0.5 block text-[0.7rem] leading-snug font-normal text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * The handful shown on the Overview tab. Earned only — this is the
 * trophy shelf, and the full catalog is one tab away.
 */
export function BadgeShowcase({
  badges,
  onSeeAll,
}: {
  badges: AwardedBadge[];
  onSeeAll: () => void;
}) {
  // Superseded tenure rungs are dropped here and only here — the
  // catalog still shows every season a member finished.
  const shelf = showcaseBadges(badges);

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Badges</h2>
          <button
            type="button"
            onClick={onSeeAll}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {/* Not the earned count: this opens the whole catalog,
                and "All 2 →" above a grid already showing both of
                them lands the reader on a page of seventeen. */}
            Browse all →
          </button>
        </div>

        {shelf.length > 0 ? (
          // Four across even at 390px: the tiles are 56px there, so
          // four fit with room, and a two-up grid would leave the
          // shelf looking half empty.
          <div className="grid grid-cols-4 gap-3">
            {shelf.slice(0, SHOWCASE_LIMIT).map((award) => (
              <BadgeTile
                key={award.key}
                badgeKey={award.key}
                award={award}
                showDetail={false}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No badges yet. Finishing a season earns the first one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** The full catalog, grouped by kind. */
export function BadgeCatalog({ badges }: { badges: AwardedBadge[] }) {
  const awarded = new Map(badges.map((award) => [award.key, award]));

  return (
    <div className="space-y-4">
      {BADGE_KINDS.map((kind) => {
        const keys = BADGE_KEYS.filter(
          (key) =>
            BADGES[key].kind === kind &&
            // Hidden until earned — the surprise is the point.
            (!BADGES[key].hidden || awarded.has(key)),
        );
        if (keys.length === 0) {
          return null;
        }

        return (
          <Card key={kind}>
            <CardContent className="space-y-3">
              <h2 className="text-sm font-semibold">
                {BADGE_KIND_LABELS[kind]}
              </h2>
              {/* Two across on a phone, not four: each tile now
                  carries a line of explanation under its label, and
                  four 80px columns leave no room to read it. */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {keys.map((key) => (
                  <BadgeTile
                    key={key}
                    badgeKey={key}
                    award={awarded.get(key)}
                    showDetail
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
