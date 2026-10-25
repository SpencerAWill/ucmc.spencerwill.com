import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { useUnlinkSiteFeedback } from "#/features/site-feedback/api/use-unlink-site-feedback";
import { useUpdateSiteFeedbackQuote } from "#/features/site-feedback/api/use-update-site-feedback-quote";
import { SITE_FEEDBACK_KIND_LABELS } from "#/features/site-feedback/server/limits";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

export type IssueLink = SiteFeedbackIssueDetail["links"][number];

/**
 * One report on an issue. `editable` rows can have their quoted text edited
 * and can be unlinked; posted reports are read-only (the server refuses to
 * change them, and GitHub has already seen the text).
 */
export function ReportRow({
  issueId,
  link,
  editable,
}: {
  issueId: string;
  link: IssueLink;
  editable: boolean;
}) {
  const updateQuote = useUpdateSiteFeedbackQuote();
  const unlink = useUnlinkSiteFeedback();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(link.quotedMd);

  const onSave = async () => {
    try {
      await updateQuote.mutateAsync({
        issueId,
        feedbackId: link.feedbackId,
        quotedMd: text,
      });
      setEditing(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the text",
      );
    }
  };

  const onUnlink = async () => {
    try {
      await unlink.mutateAsync({ issueId, feedbackId: link.feedbackId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't unlink");
    }
  };

  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{SITE_FEEDBACK_KIND_LABELS[link.kind]}</Badge>
        <span className="text-sm font-medium">{link.title}</span>
        {link.postedAt === null ? null : (
          <span className="text-xs text-muted-foreground">Posted</span>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label={`Quoted text for ${link.title}`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            rows={5}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={updateQuote.isPending || text.trim() === ""}
              onClick={() => void onSave()}
            >
              Save text
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(link.quotedMd);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {link.quotedMd}
        </p>
      )}
      {editable && !editing ? (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit text
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={unlink.isPending}
            onClick={() => void onUnlink()}
          >
            Unlink
          </Button>
        </div>
      ) : null}
    </li>
  );
}
