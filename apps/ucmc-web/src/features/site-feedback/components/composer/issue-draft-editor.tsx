import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import { MarkdownContent } from "#/components/markdown/markdown-content";
import { useDeleteSiteFeedbackIssueDraft } from "#/features/site-feedback/api/use-delete-site-feedback-issue-draft";
import { FileIssueDialog } from "#/features/site-feedback/components/composer/file-issue-dialog";
import { ReportRow } from "#/features/site-feedback/components/composer/report-row";
import { useDraftAutosave } from "#/features/site-feedback/components/composer/use-draft-autosave";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

const MAX_LABELS = 20;

const STATUS_COPY = {
  saved: "Saved",
  saving: "Saving…",
  conflict: "Not saved",
  error: "Not saved",
} as const;

const CONFLICT_COPY = {
  conflict: "Someone else edited this draft. Reload to see their changes.",
  not_draft: "This draft was filed or deleted. Reload.",
} as const;
const ERROR_COPY = "Couldn't save. Will retry on your next edit.";

/**
 * Editor for a draft issue: title, labels, markdown summary, its reports, and
 * the File / Delete actions. Local state is seeded once from `issue`; the
 * route keys this component by issue id, and autosave deliberately ignores
 * refetches so typing is never overwritten.
 */
export function IssueDraftEditor({
  issue,
}: {
  issue: SiteFeedbackIssueDetail;
}) {
  const navigate = useNavigate();
  const del = useDeleteSiteFeedbackIssueDraft();
  const autosave = useDraftAutosave({
    issueId: issue.id,
    expectedUpdatedAtMs: issue.updatedAt.epochMilliseconds,
  });

  const [title, setTitle] = useState(issue.title);
  const [summary, setSummary] = useState(issue.summaryMd ?? "");
  const [labels, setLabels] = useState<string[]>(issue.labels);
  const [labelInput, setLabelInput] = useState("");

  const change = (next: {
    title?: string;
    summaryMd?: string;
    labels?: string[];
  }) => {
    const fields = {
      title: next.title ?? title,
      summaryMd: next.summaryMd ?? summary,
      labels: next.labels ?? labels,
    };
    setTitle(fields.title);
    setSummary(fields.summaryMd);
    setLabels(fields.labels);
    autosave.schedule(fields);
  };

  const addLabel = () => {
    const label = labelInput.trim();
    if (label === "" || labels.includes(label) || labels.length >= MAX_LABELS) {
      return;
    }
    setLabelInput("");
    change({ labels: [...labels, label] });
  };

  const conflict = autosave.status === "conflict";

  const onDelete = async () => {
    try {
      await del.mutateAsync(issue.id);
      await navigate({ to: "/feedback/site/triage" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete");
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="issue-title">Title</Label>
          <span
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {STATUS_COPY[autosave.status]}
          </span>
        </div>
        <Input
          id="issue-title"
          value={title}
          maxLength={256}
          disabled={conflict}
          onChange={(e) => {
            change({ title: e.target.value });
          }}
        />
        {title.trim() === "" ? (
          <p className="text-xs text-destructive">
            A title is required before this saves.
          </p>
        ) : null}
      </div>

      {conflict ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          <p>{CONFLICT_COPY[autosave.conflictReason ?? "conflict"]}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </div>
      ) : autosave.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {ERROR_COPY}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="issue-label-input">Labels</Label>
        <ul className="flex flex-wrap gap-2">
          {labels.map((label) => (
            <li key={label}>
              <Badge variant="secondary" className="gap-1">
                {label}
                <button
                  type="button"
                  aria-label={`Remove label ${label}`}
                  disabled={conflict}
                  onClick={() => {
                    change({ labels: labels.filter((l) => l !== label) });
                  }}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            id="issue-label-input"
            value={labelInput}
            maxLength={50}
            placeholder="Add a label"
            disabled={conflict}
            onChange={(e) => {
              setLabelInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLabel();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={conflict || labelInput.trim() === ""}
            onClick={addLabel}
          >
            Add label
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="issue-summary">Summary</Label>
        <Tabs defaultValue="write">
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Textarea
              id="issue-summary"
              value={summary}
              rows={10}
              maxLength={20_000}
              disabled={conflict}
              onChange={(e) => {
                change({ summaryMd: e.target.value });
              }}
            />
          </TabsContent>
          <TabsContent value="preview">
            {summary.trim() === "" ? (
              <p className="text-sm text-muted-foreground">
                Nothing to preview.
              </p>
            ) : (
              <MarkdownContent>{summary}</MarkdownContent>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Reports ({issue.links.length})</h2>
        <ul className="space-y-2">
          {issue.links.map((link) => (
            <ReportRow
              key={link.feedbackId}
              issueId={issue.id}
              link={link}
              editable
            />
          ))}
        </ul>
      </section>

      <div className="space-y-2 border-t pt-4">
        {issue.githubConfigured ? null : (
          <p className="text-sm text-muted-foreground">
            GitHub isn&apos;t configured, so filing is off.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <FileIssueDialog
            issueId={issue.id}
            reportCount={issue.links.length}
            repo={issue.githubRepo ?? ""}
            disabled={
              !issue.githubConfigured ||
              conflict ||
              issue.links.length === 0 ||
              title.trim() === ""
            }
            beforeFile={async () => {
              const result = await autosave.flush();
              if (result === "saved") {
                return null;
              }
              return result === "error" ? ERROR_COPY : CONFLICT_COPY[result];
            }}
            onFiled={() => undefined}
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline">
                Delete draft
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                <AlertDialogDescription>
                  The reports go back to the inbox. Nothing is posted anywhere.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onDelete()}>
                  Delete draft
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
