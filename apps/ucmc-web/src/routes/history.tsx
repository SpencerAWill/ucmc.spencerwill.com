import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Info, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EditMarkdownSheet } from "#/components/markdown/edit-markdown-sheet";
import { MarkdownContent } from "#/components/markdown/markdown-content";
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
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePageEnabled } from "#/features/settings/api/page-guards";
import { historyContentQueryOptions } from "#/features/history/api/queries";
import {
  useDeleteHistoricalOfficer,
  useDeleteHistoricalOfficersByYear,
} from "#/features/history/api/use-historical-officer-mutations";
import { useDeleteHonoraryMember } from "#/features/history/api/use-honorary-member-mutations";
import { HonoraryFormDialog } from "#/features/history/components/honorary-form-dialog";
import type { HonoraryFormSeed } from "#/features/history/components/honorary-form-dialog";
import { HonoraryMembers } from "#/features/history/components/honorary-members";
import { OfficerFormDialog } from "#/features/history/components/officer-form-dialog";
import type { OfficerFormSeed } from "#/features/history/components/officer-form-dialog";
import { PastOfficers } from "#/features/history/components/past-officers";
import type {
  HonoraryEntry,
  OfficerEntry,
  OfficerYearGroup,
} from "#/features/history/server/history-fns";

/**
 * /history page. Pairs the dynamic narrative markdown (single-row
 * `history_content` table, editable by `history:manage` holders) with
 * the dynamic past-officers archive + honorary-members list.
 *
 * Gated by `history:view` via `requireViewPermission`, which honors
 * the role_anonymous permission set — so the page is visible to
 * anonymous visitors when `history:view` is granted to role_anonymous
 * (and to every approved member via role_member's default grant).
 * Non-holders (whether anonymous or authenticated) get the notFound
 * boundary rather than a redirect — deep-link without permission is
 * treated as "this page is invisible to you," not "the link is broken."
 * `history:manage` is required to edit; gated separately at the
 * action layer.
 *
 * Manage UX: when a `history:manage` holder views the page, the
 * past-officer cards and honorary list grow inline edit/delete
 * affordances. Add/Edit forms open in modal Dialogs so they overlay
 * wherever the user is scrolled. The narrative editor remains its
 * own Sheet because the markdown body is much longer than the
 * structured forms.
 */
export const Route = createFileRoute("/history")({
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(context.queryClient, "history", "history:view");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(historyContentQueryOptions());
  },
  component: HistoryPage,
});

interface OfficerDeleteState {
  officer: OfficerEntry;
}

interface YearDeleteState {
  schoolYear: string;
  startYear: number;
  count: number;
}

interface HonoraryDeleteState {
  member: HonoraryEntry;
}

function HistoryPage() {
  const { data } = useSuspenseQuery(historyContentQueryOptions());
  const { hasPermission } = useAuth();
  const canManageHistory = hasPermission("history:manage");

  const [editNarrativeOpen, setEditNarrativeOpen] = useState(false);

  // Officer form dialog seed. `null` → closed; otherwise create- or
  // edit-mode payload.
  const [officerSeed, setOfficerSeed] = useState<OfficerFormSeed | null>(null);

  // Per-officer and per-year delete confirmations, each its own
  // AlertDialog state slot.
  const [deletingOfficer, setDeletingOfficer] =
    useState<OfficerDeleteState | null>(null);
  const [deletingYear, setDeletingYear] = useState<YearDeleteState | null>(
    null,
  );

  // Honorary dialog seed + delete confirm state.
  const [honorarySeed, setHonorarySeed] = useState<HonoraryFormSeed | null>(
    null,
  );
  const [deletingHonorary, setDeletingHonorary] =
    useState<HonoraryDeleteState | null>(null);

  const deleteOfficerMut = useDeleteHistoricalOfficer();
  const deleteYearMut = useDeleteHistoricalOfficersByYear();
  const deleteHonoraryMut = useDeleteHonoraryMember();

  async function confirmDeleteOfficer() {
    if (deletingOfficer === null) {
      return;
    }
    try {
      await deleteOfficerMut.mutateAsync({ id: deletingOfficer.officer.id });
      toast.success("Officer entry deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the entry.",
      );
    } finally {
      setDeletingOfficer(null);
    }
  }

  async function confirmDeleteYear() {
    if (deletingYear === null) {
      return;
    }
    try {
      const result = await deleteYearMut.mutateAsync({
        startYear: deletingYear.startYear,
      });
      toast.success(
        `Deleted ${result.deletedCount} officer ${
          result.deletedCount === 1 ? "entry" : "entries"
        } for ${deletingYear.schoolYear}.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the year.",
      );
    } finally {
      setDeletingYear(null);
    }
  }

  async function confirmDeleteHonorary() {
    if (deletingHonorary === null) {
      return;
    }
    try {
      await deleteHonoraryMut.mutateAsync({
        id: deletingHonorary.member.id,
      });
      toast.success("Honorary member deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the entry.",
      );
    } finally {
      setDeletingHonorary(null);
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-10 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            UCMC History
          </h1>
          <p className="text-sm text-muted-foreground">
            How the University of Cincinnati Mountaineering Club started, the
            people who carried it through five decades, and the friends we've
            lost along the way.
          </p>
        </div>
        {canManageHistory ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditNarrativeOpen(true)}
            aria-label="Edit history narrative"
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        ) : null}
      </header>

      {data.narrativeMarkdown.length > 0 ? (
        <MarkdownContent>{data.narrativeMarkdown}</MarkdownContent>
      ) : null}

      {canManageHistory ? (
        <EditMarkdownSheet
          slug="history.narrative"
          title="Edit history narrative"
          description="The founding story, decades-of-camaraderie overview, and Steve Must memorial. Renders as markdown — headings (##), bold, italic, links, and lists are all supported."
          open={editNarrativeOpen}
          onOpenChange={setEditNarrativeOpen}
          initialMarkdown={data.narrativeMarkdown}
          fieldLabel="Narrative"
          placeholder="Tell the club's story…"
        />
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Past officers
          </h2>
          {canManageHistory ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOfficerSeed({ mode: "create" })}
              aria-label="Add past officer entry"
            >
              <Plus className="size-4" />
              Add officer
            </Button>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A year-by-year archive of UCMC's elected leadership and equipment
          managers, beginning with the 1973–74 academic year. Role names and
          structures evolved over the decades — "Librarian" disappeared in the
          1980s, "Trip Coordinator" was added in the mid-2000s, "Gear
          Assistants" came in the 2010s — and the archive preserves each year's
          actual roles rather than back-fitting today's structure. Years marked
          "Unknown" reflect gaps in the historical record.
        </p>
        {canManageHistory ? (
          <Alert>
            <Info />
            <AlertTitle>This archive auto-populates each March.</AlertTitle>
            <AlertDescription>
              A scheduled job runs every March 1 at 08:15 UTC and snapshots the
              current officer board into this archive, encoded as the school
              year of the just-completed term (e.g. a March 2027 run writes the
              2026-27 board). The job is idempotent — if a year is already on
              file (manual entry or a previous cron run) it's left untouched.
              You can still edit, delete, or backfill any year manually with the
              affordances below.
            </AlertDescription>
          </Alert>
        ) : null}
        <PastOfficers
          groups={data.officersByYear}
          canManage={canManageHistory}
          onEditOfficer={(group, officer) =>
            setOfficerSeed({
              mode: "edit",
              officer,
              schoolYear: group.schoolYear,
              startYear: group.startYear,
            })
          }
          onDeleteOfficer={(officer) => setDeletingOfficer({ officer })}
          onDeleteYear={(group: OfficerYearGroup) =>
            setDeletingYear({
              schoolYear: group.schoolYear,
              startYear: group.startYear,
              count: group.officers.length,
            })
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Honorary members
          </h2>
          {canManageHistory ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setHonorarySeed({
                  mode: "create",
                  defaultSortOrder: data.honoraryMembers.length + 1,
                })
              }
              aria-label="Add honorary member"
            >
              <Plus className="size-4" />
              Add honorary
            </Button>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Honorary membership is granted by majority vote of the voting
          membership per Constitution §3.4, in recognition of long-running
          service to UCMC or distinguished contributions to the outdoor
          community.
        </p>
        <HonoraryMembers
          members={data.honoraryMembers}
          canManage={canManageHistory}
          onEdit={(member) => {
            // Look up the member's current slot from server-ordered
            // data so the edit-mode dialog can preserve sort_order
            // (DnD is the only path to change it).
            const idx = data.honoraryMembers.findIndex(
              (m) => m.id === member.id,
            );
            const sortOrder = idx >= 0 ? idx + 1 : 1;
            setHonorarySeed({ mode: "edit", member, sortOrder });
          }}
          onDelete={(member) => setDeletingHonorary({ member })}
        />
      </section>

      {canManageHistory ? (
        <>
          <OfficerFormDialog
            seed={officerSeed}
            onClose={() => setOfficerSeed(null)}
          />
          <HonoraryFormDialog
            seed={honorarySeed}
            onClose={() => setHonorarySeed(null)}
          />

          <AlertDialog
            open={deletingOfficer !== null}
            onOpenChange={(next) => {
              if (!next) {
                setDeletingOfficer(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this officer entry?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the historical record permanently. You can re-add
                  it later if needed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmDeleteOfficer();
                  }}
                  disabled={deleteOfficerMut.isPending}
                >
                  {deleteOfficerMut.isPending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={deletingYear !== null}
            onOpenChange={(next) => {
              if (!next) {
                setDeletingYear(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete the entire {deletingYear?.schoolYear} year?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes all {deletingYear?.count} officer{" "}
                  {deletingYear?.count === 1 ? "entry" : "entries"} for{" "}
                  {deletingYear?.schoolYear} from the archive. You can re-add
                  entries individually later, but the bulk deletion can't be
                  undone in one step.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmDeleteYear();
                  }}
                  disabled={deleteYearMut.isPending}
                >
                  {deleteYearMut.isPending
                    ? "Deleting…"
                    : `Delete ${deletingYear?.schoolYear ?? ""}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={deletingHonorary !== null}
            onOpenChange={(next) => {
              if (!next) {
                setDeletingHonorary(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete this honorary member?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the entry permanently. You can re-add it later if
                  needed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmDeleteHonorary();
                  }}
                  disabled={deleteHonoraryMut.isPending}
                >
                  {deleteHonoraryMut.isPending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </main>
  );
}
