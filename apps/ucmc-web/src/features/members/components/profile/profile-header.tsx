/**
 * The identity block at the top of a member profile: contour banner,
 * season rings, name and the one-line things a member says about
 * themselves.
 *
 * **Not a card, by design.** Boxing the banner in a bordered, rounded
 * panel made the top of the page read as one more widget in a stack
 * of widgets. The banner bleeds the full width of the viewport — the
 * route renders `TopoBanner` outside `PageContainer` to achieve that,
 * rather than pulling it out with a negative margin that would have
 * to track the container's gutter at every breakpoint (the mismatch
 * `mobile-overflow.spec.ts` exists to catch).
 *
 * Mobile-first, and the stacking is not incidental. At phone width
 * the rings sit above the name rather than beside it, because a
 * 96px avatar next to a long preferred name leaves about eleven
 * characters of column before it wraps to one word per line.
 */
import { Badge } from "#/components/ui/badge";
import { StatusBadge } from "#/features/members/components/status-badge";
import type { StatusBadgeStatus } from "#/features/members/components/status-badge";
import { SeasonRings } from "#/features/members/components/profile/season-rings";

export interface ProfileHeaderProps {
  name: string | null;
  fullName: string | null;
  preferredName: string | null;
  trailName: string | null;
  pronouns: string | null;
  statusLine: string | null;
  email: string;
  avatarKey: string | null;
  status: StatusBadgeStatus;
  ucAffiliation: string | null;
  roles: { name: string; displayName: string }[];
  completedSeasons: number;
  seasonProgress: number | null;
  /** Rendered at the top right on desktop, below the identity on a phone. */
  actions?: React.ReactNode;
}

export function ProfileHeader({
  name,
  fullName,
  preferredName,
  trailName,
  pronouns,
  statusLine,
  email,
  avatarKey,
  status,
  ucAffiliation,
  roles,
  completedSeasons,
  seasonProgress,
  actions,
}: ProfileHeaderProps) {
  // `member` is the role every approved account holds, so it says
  // nothing; and `displayName` is rendered verbatim because
  // `capitalize` mangles a label like "VP of Trips".
  const officerRoles = roles.filter((role) => role.name !== "member");

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-5">
        {/* Pulled up over the banner. Vertical only — a horizontal
            pull here would widen the document on a phone. */}
        <SeasonRings
          avatarKey={avatarKey}
          name={name}
          completedSeasons={completedSeasons}
          seasonProgress={seasonProgress}
          className="-mt-16 sm:-mt-20"
        />

        <div className="min-w-0 flex-1 space-y-1 sm:pb-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {name ? (
              <h1 className="text-xl font-semibold break-words sm:text-2xl">
                {name}
              </h1>
            ) : null}
            {pronouns ? (
              <span className="text-sm text-muted-foreground">{pronouns}</span>
            ) : null}
          </div>

          {trailName ? (
            <p className="font-medium text-primary">
              &ldquo;{trailName}&rdquo;
            </p>
          ) : null}

          {fullName && preferredName && fullName !== preferredName ? (
            <p className="truncate text-sm text-muted-foreground">{fullName}</p>
          ) : null}

          {/* `break-all`: an email is one unbroken token and will
              push the page sideways at 390px otherwise. */}
          <p className="text-sm break-all text-muted-foreground">{email}</p>
        </div>

        {actions ? (
          <div className="flex flex-wrap gap-2 sm:pb-1">{actions}</div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={status} />
        {ucAffiliation ? (
          <Badge variant="outline" className="capitalize">
            {ucAffiliation}
          </Badge>
        ) : null}
        {officerRoles.map((role) => (
          <Badge
            key={role.name}
            variant="secondary"
            className="bg-primary/10 text-primary"
          >
            {role.displayName}
          </Badge>
        ))}
      </div>

      {statusLine ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
            aria-hidden="true"
          />
          <span className="min-w-0">{statusLine}</span>
        </p>
      ) : null}
    </div>
  );
}
