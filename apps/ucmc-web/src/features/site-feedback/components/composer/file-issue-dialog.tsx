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
import { useFileSiteFeedbackIssue } from "#/features/site-feedback/api/use-file-site-feedback-issue";

/**
 * Confirm-then-file. The action resolves `ok: false` with a `message` for
 * everything GitHub-shaped (too long, already filing, GitHub refused); the
 * message is shown inline and the dialog stays open so it can be retried.
 */
export function FileIssueDialog({
  issueId,
  reportCount,
  repo,
  disabled,
  beforeFile,
  onFiled,
}: {
  issueId: string;
  reportCount: number;
  /** `owner/name` of the repository the issue is posted to. */
  repo: string;
  disabled: boolean;
  /**
   * Runs first, e.g. to flush a pending autosave. Resolves with a message to
   * show instead of filing, or null to go ahead.
   */
  beforeFile?: () => Promise<string | null>;
  onFiled: (result: { number: number; url: string }) => void;
}) {
  const file = useFileSiteFeedbackIssue();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onConfirm = async () => {
    setMessage(null);
    try {
      const blocked = (await beforeFile?.()) ?? null;
      if (blocked !== null) {
        setMessage(blocked);
        return;
      }
      const result = await file.mutateAsync(issueId);
      if (result.ok) {
        setOpen(false);
        toast.success(`Filed as #${result.number}`);
        onFiled(result);
      } else {
        setMessage(result.message);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Filing failed");
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
          File on GitHub
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>File this issue on GitHub?</AlertDialogTitle>
          <AlertDialogDescription>
            This posts {reportCount} {reportCount === 1 ? "report" : "reports"}{" "}
            publicly to {repo}.
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
            disabled={file.isPending}
            onClick={() => void onConfirm()}
          >
            Post to GitHub
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
