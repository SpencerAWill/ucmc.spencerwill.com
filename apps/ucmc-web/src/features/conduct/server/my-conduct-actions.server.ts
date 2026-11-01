/**
 * The signed-in member's own active sanctions, for `/my`. Needs a
 * session and no conduct permission: a member is entitled to see what was
 * issued to them. Statement and dates only, never internal notes, ids or
 * SCCS fields. Notes and reports are not sanctions and never appear. A
 * record whose notice failed to send still shows.
 */
import { CLUB_TIME_ZONE } from "#/config/time";
import { listActiveSanctionsFor } from "#/features/conduct/server/record-repo.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { standingFor } from "#/server/conduct/standing.server";

export interface MyActiveSanction {
  level: "warning" | "suspension" | "termination";
  statement: string;
  startsOn: Temporal.PlainDate | null;
  endsOn: Temporal.PlainDate | null;
}

export async function getMyActiveSanctionsAction(): Promise<
  MyActiveSanction[]
> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  const rows = await listActiveSanctionsFor(
    principal.userId,
    Temporal.Now.plainDateISO(CLUB_TIME_ZONE),
  );
  return rows.map((row) => ({
    level: row.level as MyActiveSanction["level"],
    statement: row.statement ?? "",
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  }));
}

export interface MyConductStanding {
  suspendedUntil: Temporal.PlainDate | null;
}

/**
 * Whether the caller is suspended, for the public `/trip-sign-up` page.
 * Null when signed out. Only the end date leaves: no record ids, and no
 * termination flag, because a terminated member is deactivated and cannot
 * hold a session.
 */
export async function getMyConductStandingAction(): Promise<MyConductStanding | null> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return null;
  }
  const { suspendedUntil } = await standingFor(principal.userId);
  return { suspendedUntil };
}
