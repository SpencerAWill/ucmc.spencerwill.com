import { Link } from "@tanstack/react-router";
import { format } from "date-fns";

import { Badge } from "#/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import type {
  AuditAction,
  AuditEntrySummary,
} from "#/features/audit/server/audit-fns";

// Actions whose `target_user_id` always points at a member. Used by
// the viewer when the FK has cascade-NULLed (member hard-deleted) so
// we can still render a "(deleted user)" placeholder instead of
// silently dropping the target column. Non-user-targeted actions
// (role.* on a role row, landing.* on a settings key, etc.) are
// intentionally absent.
const USER_TARGETED_ACTIONS = new Set<AuditAction>([
  "registration.approved",
  "registration.rejected",
  "registration.unrejected",
  "member.pre_added",
  "member.unclaimed_edited",
  // member.unclaimed_deleted intentionally absent — that action's
  // FK cascade already removes the user, so the metadata snapshot
  // (email + placeholderName) carries the identity. The "Target:
  // (deleted user)" generic-fallback path is too vague for it.
  "member.claimed",
  "member.deactivated",
  "member.reactivated",
  "member.banned",
  "member.unbanned",
  "member.self_deleted",
  "member.sessions_revoked",
  "profile.force_edited",
  "email.added",
  "email.removed",
  "email.primary_changed",
  "role.assigned",
  "role.unassigned",
  "waiver.attested",
  "waiver.revoked",
]);

export function AuditCard({ entry }: { entry: AuditEntrySummary }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary" className="font-mono text-xs">
            {entry.action}
          </Badge>
          <CardTitle className="text-sm font-medium">
            <ActorLabel entry={entry} />
          </CardTitle>
        </div>
        <CardDescription className="text-xs">
          <time dateTime={new Date(entry.createdAt).toISOString()}>
            {format(new Date(entry.createdAt), "PPpp")}
          </time>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <TargetLabel entry={entry} />
        {entry.metadata ? (
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActorLabel({ entry }: { entry: AuditEntrySummary }) {
  if (entry.actor) {
    const name = entry.actor.preferredName ?? entry.actor.email;
    // Link to the member's profile page — fastest way to investigate
    // "what else has this person done?".
    return (
      <Link
        to="/members/$publicId"
        params={{ publicId: entry.actor.publicId }}
        className="underline-offset-2 hover:underline"
      >
        {name}
      </Link>
    );
  }
  // Actor FK has been cascade-NULLed (user hard-deleted). The
  // documented metadata exceptions (`member.self_deleted`, plus the
  // `email.*` lifecycle events) capture the email value so the row
  // remains useful — surface it. See the audit-log.server.ts
  // doc-comment for the full list.
  const meta = entry.metadata;
  if (typeof meta?.email === "string" && meta.email.length > 0) {
    return (
      <span className="text-muted-foreground">{meta.email} (deleted)</span>
    );
  }
  return <span className="text-muted-foreground">(deleted user)</span>;
}

function TargetLabel({ entry }: { entry: AuditEntrySummary }) {
  // User target with a live FK — link to their profile.
  if (entry.target) {
    const name = entry.target.preferredName ?? entry.target.email;
    return (
      <p>
        Target:{" "}
        <Link
          to="/members/$publicId"
          params={{ publicId: entry.target.publicId }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {name}
        </Link>
      </p>
    );
  }
  // User target whose FK has cascaded to NULL — fall back to the
  // metadata-captured email if the action documented one (today
  // that's `member.self_deleted` and the `email.*` lifecycle
  // events). Without this fallback, most historical member-targeted
  // events lose their target label entirely after retention runs.
  const meta = entry.metadata;
  if (typeof meta?.email === "string" && meta.email.length > 0) {
    return (
      <p className="text-muted-foreground">Target: {meta.email} (deleted)</p>
    );
  }
  // User-targeted action whose FK has cascaded AND no email
  // captured in metadata — e.g. an old `member.deactivated` whose
  // target was later hard-deleted via the retention sweep. Show a
  // generic deleted-user placeholder rather than dropping the
  // target column entirely; otherwise the row reads as if it had
  // no target at all.
  if (USER_TARGETED_ACTIONS.has(entry.action)) {
    return <p className="text-muted-foreground">Target: (deleted user)</p>;
  }
  // Non-user target (role / landing setting / waiver attestation).
  if (entry.targetType && entry.targetId) {
    return (
      <p>
        Target:{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          {entry.targetType}:{entry.targetId}
        </code>
      </p>
    );
  }
  return null;
}
