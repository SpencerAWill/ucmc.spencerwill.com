import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { requireViewPermission } from "#/features/auth/guards";
import { gazetteListQueryOptions } from "#/features/gazette/api/queries";
import { useDeleteGazetteIssue } from "#/features/gazette/api/use-gazette-mutations";
import { GazetteList } from "#/features/gazette/components/gazette-list";
import { IssueFormDialog } from "#/features/gazette/components/issue-form-dialog";
import type { IssueFormSeed } from "#/features/gazette/components/issue-form-dialog";
import type { GazetteIssueSummary } from "#/features/gazette/server/gazette-fns";

/**
 * Public /gazette index. View gated by `public_gazette:view`
 * (default-granted to role_anonymous + role_member, mirrors the
 * other public_*:view conventions). Manage UX (Add Issue button +
 * pencil/trash per card) gated by `public_gazette:manage`.
 *
 * Form dialogs + the delete confirm live at the route level so they
 * can overlay wherever the user is scrolled in the list. The
 * `IssueFormDialog` is shared by Add and Edit; mode is carried in
 * the seed payload.
 */
export const Route = createFileRoute("/gazette/")({
  beforeLoad: async ({ context }) => {
    await requireViewPermission(context.queryClient, "public_gazette:view");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(gazetteListQueryOptions());
  },
  component: GazettePage,
});

function GazettePage() {
  const { data } = useSuspenseQuery(gazetteListQueryOptions());
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_gazette:manage");

  const [formSeed, setFormSeed] = useState<IssueFormSeed | null>(null);
  const [deletingIssue, setDeletingIssue] =
    useState<GazetteIssueSummary | null>(null);
  const deleteMut = useDeleteGazetteIssue();

  // For "Add issue", default the form's schoolYear and issueNumber to
  // sensible next-slot values. We do this from the route component
  // rather than the dialog because the route owns the issues array.
  function startCreate() {
    const mostRecent = data.issues.at(0);
    setFormSeed({
      mode: "create",
      defaultSchoolYear: mostRecent?.schoolYear,
      defaultIssueNumber: nextIssueNumberFor(
        data.issues,
        mostRecent?.schoolYear ?? "",
      ),
    });
  }

  async function confirmDelete() {
    if (deletingIssue === null) {
      return;
    }
    try {
      await deleteMut.mutateAsync({ publicId: deletingIssue.publicId });
      toast.success("Issue deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the issue.",
      );
    } finally {
      setDeletingIssue(null);
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Goosedown Gazette
          </h1>
          <p className="text-sm text-muted-foreground">
            UCMC's club newsletter, by year and issue. Read inline or download a
            copy.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={startCreate}
            aria-label="Add Gazette issue"
          >
            <Plus className="size-4" />
            Add issue
          </Button>
        ) : null}
      </header>

      <GazetteList
        issues={data.issues}
        canManage={canManage}
        onEditIssue={(issue) => setFormSeed({ mode: "edit", issue })}
        onDeleteIssue={(issue) => setDeletingIssue(issue)}
      />

      {canManage ? (
        <>
          <IssueFormDialog seed={formSeed} onClose={() => setFormSeed(null)} />
          <AlertDialog
            open={deletingIssue !== null}
            onOpenChange={(next) => {
              if (!next) {
                setDeletingIssue(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this Gazette issue?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the row, the PDF on R2, and the issue card from
                  /gazette. You can re-upload from a fresh file later, but the
                  row's publicId won't be the same.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmDelete();
                  }}
                  disabled={deleteMut.isPending}
                >
                  {deleteMut.isPending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </main>
  );
}

/** Suggest the next issue number for a given school year — max + 1
 * within that year, or 1 if it's a new year. */
function nextIssueNumberFor(
  issues: GazetteIssueSummary[],
  schoolYear: string,
): number {
  const matching = issues.filter((i) => i.schoolYear === schoolYear);
  if (matching.length === 0) {
    return 1;
  }
  return Math.max(...matching.map((i) => i.issueNumber)) + 1;
}
