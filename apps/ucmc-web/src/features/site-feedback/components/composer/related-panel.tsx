import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  relatedSiteFeedbackQueryOptions,
  siteFeedbackTriageQueryOptions,
} from "#/features/site-feedback/api/queries";
import { useLinkSiteFeedback } from "#/features/site-feedback/api/use-link-site-feedback";
import { SITE_FEEDBACK_KIND_LABELS } from "#/features/site-feedback/server/limits";
import type { SiteFeedbackTriageRow } from "#/features/site-feedback/server/site-feedback-triage-fns";

const SEARCH_DEBOUNCE_MS = 300;

function CandidateRow({
  row,
  onAdd,
  disabled,
}: {
  row: SiteFeedbackTriageRow;
  onAdd: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <li className="space-y-1 rounded-md border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Badge variant="outline">{SITE_FEEDBACK_KIND_LABELS[row.kind]}</Badge>
          <p className="text-sm font-medium break-words">{row.title}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`Add ${row.title}`}
          onClick={() => {
            onAdd(row.id);
          }}
        >
          + Add
        </Button>
      </div>
    </li>
  );
}

/** Reports that look related to the issue, plus a search over the inbox. */
export function RelatedPanel({
  issueId,
  linkedIds,
}: {
  issueId: string;
  linkedIds: ReadonlySet<string>;
}) {
  const link = useLinkSiteFeedback();
  const [input, setInput] = useState("");
  const [q, setQ] = useState<string | undefined>(undefined);

  useEffect(() => {
    const next = input.trim() === "" ? undefined : input.trim();
    const t = setTimeout(() => {
      setQ(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [input]);

  const related = useQuery(relatedSiteFeedbackQueryOptions(issueId));
  const search = useQuery({
    ...siteFeedbackTriageQueryOptions({ view: "new", q }),
    enabled: q !== undefined,
  });

  const onAdd = async (feedbackId: string) => {
    try {
      await link.mutateAsync({ issueId, feedbackIds: [feedbackId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add");
    }
  };

  const searching = q !== undefined;
  const rows = (searching ? search.data?.rows : related.data) ?? [];
  const visible = rows.filter((r) => !linkedIds.has(r.id));
  const loading = searching ? search.isPending : related.isPending;
  const failed = searching ? search.isError : related.isError;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Possibly related</h2>
      <Input
        type="search"
        aria-label="Search reports"
        placeholder="Search new reports"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
        }}
      />
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load reports.
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {searching ? "No matching reports." : "Nothing looks related."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <CandidateRow
              key={row.id}
              row={row}
              disabled={link.isPending}
              onAdd={(id) => void onAdd(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
