import { useSuspenseQueries } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { WAIVER_PDF_PATH, WAIVER_VERSION } from "#/config/legal";
import {
  myWaiverHistoryQueryOptions,
  myWaiverStatusQueryOptions,
} from "#/features/auth/api/waiver-queries";
import type { WaiverAttestationSummary } from "#/features/auth/server/waiver-fns";

/**
 * Member's view of their paper-waiver attestation status. Read-only
 * by design: the actual attestation happens off-platform when an
 * officer marks the member's signed paper as received. Members come
 * here to:
 *   - confirm whether they're attested for the current cycle
 *   - download a fresh blank waiver PDF if they need to print one
 *   - read past attestations as a record of compliance
 *
 * No file upload, no medical PII storage — the signed paper lives
 * with the Treasurer per Bylaw 1.3.
 */
export const Route = createFileRoute("/account/waiver")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(myWaiverStatusQueryOptions()),
      context.queryClient.ensureQueryData(myWaiverHistoryQueryOptions()),
    ]),
  component: WaiverTab,
});

function WaiverTab() {
  const [statusQuery, historyQuery] = useSuspenseQueries({
    queries: [myWaiverStatusQueryOptions(), myWaiverHistoryQueryOptions()],
  });
  const status = statusQuery.data;
  const history = historyQuery.data;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Waiver of liability</h2>
        <p className="text-sm text-muted-foreground">
          The signed paper waiver is held by the Treasurer. This page only
          tracks whether an officer has confirmed your paper is on file for the
          current academic cycle ({status.cycle}).
        </p>
      </header>

      <CurrentStatusCard status={status} />
      <NextStepsCard isAttested={status.current !== null} />
      <HistoryCard history={history} />
    </div>
  );
}

function CurrentStatusCard({
  status,
}: {
  status: {
    cycle: string;
    version: string;
    current: WaiverAttestationSummary | null;
  };
}) {
  const attestation = status.current;

  if (attestation) {
    return (
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge>Attested</Badge>
            <span className="text-sm font-medium">Cycle {status.cycle}</span>
          </div>
          <p className="text-sm">
            Marked attested by{" "}
            {attestation.attestedByPreferredName ?? attestation.attestedByEmail}{" "}
            on{" "}
            <time dateTime={new Date(attestation.attestedAt).toISOString()}>
              {new Date(attestation.attestedAt).toLocaleDateString()}
            </time>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Waiver version <code>{attestation.version}</code>. Re-attestation
            will be required after the next academic cycle rolls over.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="destructive">Not attested</Badge>
          <span className="text-sm font-medium">Cycle {status.cycle}</span>
        </div>
        <p className="text-sm">
          You don't have a current attestation on file for this academic cycle.
          Print, sign, and bring your paper waiver to a club meeting to get
          attested.
        </p>
      </CardContent>
    </Card>
  );
}

function NextStepsCard({ isAttested }: { isAttested: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-semibold">
          {isAttested ? "Need a new copy?" : "How to get attested"}
        </h3>
        <ol className="ml-5 list-decimal space-y-1 text-sm">
          <li>
            Download and print the canonical waiver PDF (version{" "}
            <code>{WAIVER_VERSION}</code>).
          </li>
          <li>
            Fill in your information, emergency contact, and medical info.
          </li>
          <li>Sign and date the form.</li>
          <li>
            Bring it to a club meeting. The Treasurer or President will confirm
            your paper is on file and mark you attested here.
          </li>
        </ol>
        <div>
          <Button asChild>
            <a href={WAIVER_PDF_PATH} download>
              Download blank waiver PDF
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ history }: { history: WaiverAttestationSummary[] }) {
  if (history.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-semibold">Attestation history</h3>
        <ul className="space-y-3 text-sm">
          {history.map((row) => (
            <li
              key={row.id}
              className="grid gap-1 border-l-2 border-muted-foreground/20 pl-3"
            >
              <div className="flex items-center gap-2">
                <Badge variant={row.revokedAt ? "secondary" : "default"}>
                  {row.revokedAt ? "Revoked" : "Attested"}
                </Badge>
                <span>Cycle {row.cycle}</span>
                <span className="text-xs text-muted-foreground">
                  v{row.version}
                </span>
              </div>
              <p className="text-muted-foreground">
                {new Date(row.attestedAt).toLocaleDateString()} by{" "}
                {row.attestedByPreferredName ?? row.attestedByEmail}
                {row.notes ? ` — "${row.notes}"` : null}
              </p>
              {row.revokedAt ? (
                <p className="text-xs text-muted-foreground">
                  Revoked {new Date(row.revokedAt).toLocaleDateString()}
                  {row.revocationReason ? ` — ${row.revocationReason}` : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
