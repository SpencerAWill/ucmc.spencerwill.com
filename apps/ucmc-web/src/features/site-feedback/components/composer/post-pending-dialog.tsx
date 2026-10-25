import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { usePostPendingSiteFeedbackReports } from "#/features/site-feedback/api/use-post-pending-site-feedback-reports";

/**
 * Confirm-then-post for reports linked after filing (or attached to a
 * hand-made issue). Modelled on `FileIssueDialog`: an `ok: false` result's
 * `message` is shown inline and the dialog stays open so it can be retried.
 */
export function PostPendingDialog({
  issueId,
  count,
  repo,
  disabled,
}: {
  issueId: string;
  count: number;
  /** `owner/name` of the repository the comment is posted to. */
  repo: string;
  disabled: boolean;
}) {
  const post = usePostPendingSiteFeedbackReports();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const noun = count === 1 ? "report" : "reports";

  const onConfirm = async () => {
    setMessage(null);
    try {
      const result = await post.mutateAsync(issueId);
      if (result.ok) {
        setOpen(false);
        toast.success(
          `Posted ${result.posted} ${result.posted === 1 ? "report" : "reports"}`,
        );
      } else {
        setMessage(result.message);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't post");
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setMessage(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" disabled={disabled}>
          Post {count} new {noun}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Post these reports on GitHub?</AlertDialogTitle>
          <AlertDialogDescription>
            This posts {count} {noun} publicly to {repo}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {message === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            disabled={post.isPending}
            onClick={() => void onConfirm()}
          >
            Post to GitHub
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
