import { APPEAL_LINE } from "#/features/conduct/server/limits";
import type { TerminationNotice } from "#/features/conduct/server/termination-notice-fns";

/**
 * The body of `/deactivated`. A termination notice (for a visitor who
 * proved who they are) shows the statement the Executive Committee sent;
 * `terminated` alone (`?reason=terminated`, reached with no session or
 * proof) shows the heading and the appeal route without a statement;
 * anything else is the generic deactivation copy.
 */
export function DeactivatedNotice({
  notice,
  terminated,
}: {
  notice: TerminationNotice | null;
  terminated: boolean;
}) {
  if (notice || terminated) {
    return (
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Your membership was terminated by the Executive Committee
        </h1>
        {notice ? (
          <p className="text-sm whitespace-pre-wrap">{notice.statement}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {notice?.appealText ?? APPEAL_LINE}
        </p>
      </header>
    );
  }
  return (
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Account deactivated</h1>
      <p className="text-sm text-muted-foreground">
        Your account has been deactivated by a club administrator. If you
        believe this is an error, please contact a club officer to have your
        account reactivated.
      </p>
    </header>
  );
}
