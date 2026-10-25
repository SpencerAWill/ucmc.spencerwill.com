import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { useAttachSiteFeedbackToGithubIssue } from "#/features/site-feedback/api/use-attach-site-feedback-to-github-issue";
import { useCreateSiteFeedbackIssueDraft } from "#/features/site-feedback/api/use-create-site-feedback-issue-draft";
import { useLinkSiteFeedback } from "#/features/site-feedback/api/use-link-site-feedback";
import { useSetSiteFeedbackDisposition } from "#/features/site-feedback/api/use-set-site-feedback-disposition";
import type { SiteFeedbackIssueSummary } from "#/features/site-feedback/server/site-feedback-triage-fns";

export interface TriageSelectionToolbarProps {
  selectedIds: string[];
  drafts: SiteFeedbackIssueSummary[];
  openIssues: SiteFeedbackIssueSummary[];
  githubConfigured: boolean;
  /** Called after any action succeeds, so the page can clear its selection. */
  onDone: () => void;
}

const GITHUB_NUMBER = /^#?(\d{1,9})$/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Sticky bar over the inbox; renders nothing until something is selected. */
export function TriageSelectionToolbar({
  selectedIds,
  drafts,
  openIssues,
  githubConfigured,
  onDone,
}: TriageSelectionToolbarProps) {
  const navigate = useNavigate();
  const createDraft = useCreateSiteFeedbackIssueDraft();
  const setDisposition = useSetSiteFeedbackDisposition();
  const link = useLinkSiteFeedback();
  const attach = useAttachSiteFeedbackToGithubIssue();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (selectedIds.length === 0) {
    return null;
  }

  const busy =
    createDraft.isPending ||
    setDisposition.isPending ||
    link.isPending ||
    attach.isPending;
  const typedNumber = GITHUB_NUMBER.exec(search.trim())?.[1];

  const onNewDraft = async () => {
    try {
      const { id } = await createDraft.mutateAsync({
        feedbackIds: selectedIds,
      });
      onDone();
      await navigate({
        to: "/feedback/site/triage/issues/$issueId",
        params: { issueId: id },
      });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onDisposition = async (disposition: "wont_fix" | "duplicate") => {
    try {
      const { updated } = await setDisposition.mutateAsync({
        ids: selectedIds,
        disposition,
      });
      toast.success(
        `Marked ${updated} ${updated === 1 ? "report" : "reports"} ${disposition === "wont_fix" ? "won't fix" : "duplicate"}`,
      );
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onLink = async (issue: SiteFeedbackIssueSummary) => {
    setPickerOpen(false);
    try {
      const { added } = await link.mutateAsync({
        issueId: issue.id,
        feedbackIds: selectedIds,
      });
      toast.success(
        `Added ${added} ${added === 1 ? "report" : "reports"} to ${issue.title}`,
      );
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onAttach = async (number: number) => {
    setPickerOpen(false);
    try {
      const result = await attach.mutateAsync({
        number,
        feedbackIds: selectedIds,
      });
      if (result.ok) {
        toast.success(`Attached to GitHub issue #${number}`);
        onDone();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // cmdk's own filter is off: it scores "#123" against "github-issue-123" as
  // no match and would hide the numeric entry, and it fuzzy-matches ids.
  const needle = search.trim().toLowerCase();
  const matches = (issue: SiteFeedbackIssueSummary) =>
    needle === "" ||
    issue.title.toLowerCase().includes(needle) ||
    (issue.githubNumber !== null && `#${issue.githubNumber}`.includes(needle));
  const shownDrafts = drafts.filter(matches);
  const shownOpen = openIssues.filter(matches);

  return (
    <div
      role="toolbar"
      aria-label="Selected reports"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background p-2 shadow-sm"
    >
      <span className="px-1 text-sm font-medium">
        {selectedIds.length} selected
      </span>
      <Button type="button" size="sm" disabled={busy} onClick={onNewDraft}>
        <Plus aria-hidden="true" />
        New draft
      </Button>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={busy}>
            Add to…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Find an issue, or type a GitHub #"
            />
            <CommandList>
              {typedNumber !== undefined && githubConfigured ? (
                <CommandGroup heading="GitHub">
                  <CommandItem
                    value={`github-issue-${typedNumber}`}
                    onSelect={() => {
                      void onAttach(Number(typedNumber));
                    }}
                  >
                    GitHub issue #{typedNumber}
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {shownDrafts.length > 0 ? (
                <CommandGroup heading="Drafts">
                  {shownDrafts.map((issue) => (
                    <CommandItem
                      key={issue.id}
                      value={issue.id}
                      onSelect={() => {
                        void onLink(issue);
                      }}
                    >
                      {issue.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {shownOpen.length > 0 ? (
                <CommandGroup heading="Filed (open)">
                  {shownOpen.map((issue) => (
                    <CommandItem
                      key={issue.id}
                      value={issue.id}
                      onSelect={() => {
                        void onLink(issue);
                      }}
                    >
                      {issue.githubNumber === null
                        ? issue.title
                        : `#${issue.githubNumber} ${issue.title}`}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {shownDrafts.length === 0 &&
              shownOpen.length === 0 &&
              !(typedNumber !== undefined && githubConfigured) ? (
                <CommandEmpty>No matching issue.</CommandEmpty>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          void onDisposition("wont_fix");
        }}
      >
        Won&apos;t fix
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          void onDisposition("duplicate");
        }}
      >
        Duplicate
      </Button>
    </div>
  );
}
