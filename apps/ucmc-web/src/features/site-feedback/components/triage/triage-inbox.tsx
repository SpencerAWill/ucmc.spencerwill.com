import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Checkbox } from "#/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { TriageSelectionToolbar } from "#/features/site-feedback/components/triage/triage-selection-toolbar";
import {
  SITE_FEEDBACK_KIND_LABELS,
  SITE_FEEDBACK_TRIAGE_VIEW_VALUES,
} from "#/features/site-feedback/server/limits";
import type { SiteFeedbackTriageView } from "#/features/site-feedback/server/limits";
import type { SiteFeedbackTriage } from "#/features/site-feedback/server/site-feedback-triage-fns";
import { formatRelative } from "#/lib/date-format";
import { cn } from "#/lib/utils";

const VIEW_LABELS: Record<SiteFeedbackTriageView, string> = {
  new: "New",
  in_draft: "In draft",
  tracked: "Tracked",
  closed: "Closed",
};

const SEARCH_DEBOUNCE_MS = 300;

export interface TriageInboxProps {
  data: SiteFeedbackTriage;
  view: SiteFeedbackTriageView;
  q: string | undefined;
  onViewChange: (view: SiteFeedbackTriageView) => void;
  /** Receives the debounced search, `undefined` when cleared. */
  onQueryChange: (q: string | undefined) => void;
}

function pagePath(pageUrl: string | null): string | null {
  if (pageUrl === null) {
    return null;
  }
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

function browserName(userAgent: string | null): string | null {
  if (userAgent === null) {
    return null;
  }
  if (/Edg\//.test(userAgent)) {
    return "Edge";
  }
  if (/Firefox\//.test(userAgent)) {
    return "Firefox";
  }
  if (/Chrome\//.test(userAgent)) {
    return "Chrome";
  }
  if (/Safari\//.test(userAgent)) {
    return "Safari";
  }
  return null;
}

/** View chips, debounced search and the checkbox list, with its toolbar. */
export function TriageInbox({
  data,
  view,
  q,
  onViewChange,
  onQueryChange,
}: TriageInboxProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [input, setInput] = useState(q ?? "");

  useEffect(() => {
    const next = input.trim() === "" ? undefined : input.trim();
    if (next === q) {
      return;
    }
    const timer = setTimeout(() => {
      onQueryChange(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [input, q, onQueryChange]);

  // A selection only means something for rows still on screen.
  const rowIds = new Set(data.rows.map((r) => r.id));
  const selectedIds = [...selected].filter((id) => rowIds.has(id));
  const allSelected =
    data.rows.length > 0 && selectedIds.length === data.rows.length;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelected(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SITE_FEEDBACK_TRIAGE_VIEW_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === view}
            onClick={() => {
              setSelected(new Set());
              onViewChange(v);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              v === view
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {VIEW_LABELS[v]} ({data.counts[v]})
          </button>
        ))}
      </div>
      <Input
        type="search"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
        }}
        placeholder="Search reports"
        aria-label="Search reports"
      />
      <TriageSelectionToolbar
        selectedIds={selectedIds}
        drafts={data.drafts}
        openIssues={data.openIssues}
        githubConfigured={data.githubConfigured}
        onDone={() => {
          setSelected(new Set());
        }}
      />
      {data.rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {q === undefined
                ? "Nothing here."
                : "No reports match that search."}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <div className="flex items-center gap-3 border-b px-3 py-2 text-sm text-muted-foreground">
            <Checkbox
              id="triage-select-all"
              checked={allSelected}
              onCheckedChange={(on) => {
                setSelected(
                  on === true ? new Set(data.rows.map((r) => r.id)) : new Set(),
                );
              }}
            />
            <Label htmlFor="triage-select-all" className="font-normal">
              Select all
            </Label>
          </div>
          <ul className="divide-y">
            {data.rows.map((row) => {
              const path = pagePath(row.pageUrl);
              const browser = browserName(row.userAgent);
              return (
                <li key={row.id} className="flex gap-3 px-3 py-3">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(row.id)}
                    onCheckedChange={(on) => {
                      toggle(row.id, on === true);
                    }}
                    aria-label={`Select ${row.title}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {SITE_FEEDBACK_KIND_LABELS[row.kind]}
                      </Badge>
                      <span className="font-medium">{row.title}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {row.body}
                    </p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {path === null ? null : <span>{path}</span>}
                      {browser === null ? null : <span>{browser}</span>}
                      <span>{formatRelative(row.createdAt)}</span>
                      {row.issues.map((issue) => (
                        <Link
                          key={issue.id}
                          to="/feedback/site/triage/issues/$issueId"
                          params={{ issueId: issue.id }}
                          className="underline"
                        >
                          {issue.githubNumber === null
                            ? issue.title
                            : `#${issue.githubNumber}`}
                        </Link>
                      ))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
