import type { OfficerYearGroup } from "#/features/history/server/history-fns";

/**
 * Renders the past-officer archive grouped by school year, newest
 * first. Each year is a small block: the school-year label as a sub-
 * heading, then a definition-list of role → holder. Free-form role
 * text matches what each year's exec board was actually called; the
 * roster intentionally preserves "Unknown" / "X" placeholders for
 * years where the source data is incomplete.
 */
export function PastOfficers({ groups }: { groups: OfficerYearGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Past-officer records are being assembled. Check back soon.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <article
          key={group.schoolYear}
          className="space-y-2 rounded-md border border-border/60 bg-card/50 p-4"
        >
          <h3 className="text-sm font-semibold tracking-tight">
            {group.schoolYear}
          </h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {group.officers.map((officer) => (
              <div key={officer.id} className="contents">
                <dt className="font-medium text-muted-foreground">
                  {officer.role}
                </dt>
                <dd>{officer.name}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
