import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarPlus, Pencil, Plus } from "lucide-react";
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
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { pageHeroQueryOptions } from "#/features/landing/api/queries";
import { PageHero } from "#/features/landing/components/page-hero";
import {
  publicFlagsQueryOptions,
  publicSiteContactQueryOptions,
} from "#/features/settings/api/queries";
import { requirePageEnabled } from "#/features/settings/api/page-guards";
import { volunteerContentQueryOptions } from "#/features/volunteer/api/queries";
import { markdownPageQueryOptions } from "#/server/markdown-pages/queries";
import { useDeleteEvent } from "#/features/volunteer/api/use-event-mutations";
import { useDeleteOpportunity } from "#/features/volunteer/api/use-opportunity-mutations";
import { OutingFormDialog } from "#/features/volunteer/components/outing-form-dialog";
import type { OutingFormSeed } from "#/features/volunteer/components/outing-form-dialog";
import { ProgramFormDialog } from "#/features/volunteer/components/program-form-dialog";
import type { ProgramFormSeed } from "#/features/volunteer/components/program-form-dialog";
import { RequestVolunteers } from "#/features/volunteer/components/request-volunteers";
import { ServiceRecord } from "#/features/volunteer/components/service-record";
import { UpcomingOutings } from "#/features/volunteer/components/upcoming-outings";
import { VolunteerPrograms } from "#/features/volunteer/components/volunteer-programs";
import type {
  VolunteerEventEntry,
  VolunteerOpportunityEntry,
} from "#/features/volunteer/server/volunteer-fns";

/**
 * Public /volunteer page (#184). Four readers, one page: a prospective
 * member asking what the club does, a current member looking for
 * something to join, an outside organization deciding whether to ask,
 * and an officer editing all of it in place.
 *
 * Gated by `public_volunteer:view` through `requirePageEnabled`, which
 * honours the role_anonymous permission set — visible to signed-out
 * visitors while that grant stands, and to every approved member via
 * role_member's grant. Non-holders get the notFound boundary rather
 * than a redirect: a deep link without permission means "this page is
 * invisible to you", not "the link is broken".
 *
 * `public_volunteer:manage` is required to edit, gated at the action
 * layer. Every manage affordance here asks `hasPermission` rather than
 * testing for the presence of a field in the payload, so role preview
 * narrows the page the way it narrows the sidebar.
 */
export const Route = createFileRoute("/volunteer")({
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(
      context.queryClient,
      "volunteer",
      "public_volunteer:view",
    );
  },
  loader: async ({ context }) => {
    // The hero paints first, so it's prefetched alongside the page's own
    // data rather than fetched after hydration — otherwise the band
    // shows registry defaults and swaps once the query lands.
    await Promise.all([
      context.queryClient.ensureQueryData(volunteerContentQueryOptions()),
      context.queryClient.ensureQueryData(
        markdownPageQueryOptions("volunteer"),
      ),
      context.queryClient.ensureQueryData(pageHeroQueryOptions("volunteer")),
    ]);
  },
  component: VolunteerPage,
});

function VolunteerPage() {
  const { data } = useSuspenseQuery(volunteerContentQueryOptions());
  // The narrative is its own cache entry, not part of the bundle above:
  // `useUpdateMarkdownPage` invalidates `["markdown-page", slug]` only, so
  // a copy in the bundle would still render pre-save text after a save —
  // and would then seed the sheet's next edit, overwriting it.
  const { data: narrative } = useSuspenseQuery(
    markdownPageQueryOptions("volunteer"),
  );
  const contactOptions = publicSiteContactQueryOptions();
  const { data: contact } = useQuery(contactOptions);
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_volunteer:manage");
  // The archive's per-outing "Photos" link targets /album, which is
  // behind both its own permission and its kill switch. Gate the link on
  // the flag of the page it actually navigates to, or a tagged row on a
  // public page sends visitors to a notFound.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const canLinkToAlbum =
    hasPermission("public_album:view") && flags.pages.album;

  const [editNarrativeOpen, setEditNarrativeOpen] = useState(false);
  const [programSeed, setProgramSeed] = useState<ProgramFormSeed | null>(null);
  const [outingSeed, setOutingSeed] = useState<OutingFormSeed | null>(null);
  const [deletingProgram, setDeletingProgram] =
    useState<VolunteerOpportunityEntry | null>(null);
  const [deletingOuting, setDeletingOuting] =
    useState<VolunteerEventEntry | null>(null);

  const deleteProgramMut = useDeleteOpportunity();
  const deleteOutingMut = useDeleteEvent();

  async function confirmDeleteProgram() {
    if (deletingProgram === null) {
      return;
    }
    try {
      await deleteProgramMut.mutateAsync({ id: deletingProgram.id });
      toast.success("Program deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the program.",
      );
    } finally {
      setDeletingProgram(null);
    }
  }

  async function confirmDeleteOuting() {
    if (deletingOuting === null) {
      return;
    }
    try {
      await deleteOutingMut.mutateAsync({ id: deletingOuting.id });
      toast.success("Outing deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the outing.",
      );
    } finally {
      setDeletingOuting(null);
    }
  }

  return (
    <>
      <PageHero page="volunteer" />
      <main
        id="main"
        className="mx-auto w-full max-w-2xl space-y-10 px-6 py-12"
      >
        {canManage ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditNarrativeOpen(true)}
              aria-label="Edit volunteering introduction"
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          </div>
        ) : null}

        {narrative.markdown.length > 0 ? (
          <MarkdownContent>{narrative.markdown}</MarkdownContent>
        ) : null}

        {canManage ? (
          <EditMarkdownSheet
            slug="volunteer"
            title="Edit volunteering introduction"
            description="Why the club volunteers and what a day out looks like. Renders as markdown — headings (##), bold, italic, links, and lists are all supported."
            open={editNarrativeOpen}
            onOpenChange={setEditNarrativeOpen}
            initialMarkdown={narrative.markdown}
            fieldLabel="Introduction"
            placeholder="Why we volunteer…"
          />
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">What we do</h2>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProgramSeed({ mode: "create" })}
                aria-label="Add volunteer program"
              >
                <Plus className="size-4" />
                Add program
              </Button>
            ) : null}
          </div>
          <VolunteerPrograms
            programs={data.opportunities}
            canManage={canManage}
            onEdit={(program) => setProgramSeed({ mode: "edit", program })}
            onDelete={setDeletingProgram}
          />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Coming up</h2>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOutingSeed({ mode: "create" })}
                aria-label="Add volunteer outing"
              >
                <CalendarPlus className="size-4" />
                Add outing
              </Button>
            ) : null}
          </div>
          <UpcomingOutings
            outings={data.upcoming}
            clubEmail={contact?.clubEmail}
            canManage={canManage}
            onEdit={(outing) => setOutingSeed({ mode: "edit", outing })}
            onDelete={setDeletingOuting}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Our record</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every outing the club has logged, newest first. Volunteer counts and
            service hours are recorded after the fact, so older entries may
            carry fewer numbers than recent ones.
          </p>
          <ServiceRecord
            outings={data.past}
            canLinkToAlbum={canLinkToAlbum}
            canManage={canManage}
            onEdit={(outing) => setOutingSeed({ mode: "edit", outing })}
            onDelete={setDeletingOuting}
          />
        </section>

        <RequestVolunteers clubEmail={contact?.clubEmail} />

        {canManage ? (
          <>
            <ProgramFormDialog
              seed={programSeed}
              onClose={() => setProgramSeed(null)}
            />
            <OutingFormDialog
              seed={outingSeed}
              onClose={() => setOutingSeed(null)}
            />

            <AlertDialog
              open={deletingProgram !== null}
              onOpenChange={(next) => {
                if (!next) {
                  setDeletingProgram(null);
                }
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this program?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{deletingProgram?.title}” stops appearing under “What we
                    do”. Outings already on record are unaffected — they don't
                    reference programs.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void confirmDeleteProgram();
                    }}
                    disabled={deleteProgramMut.isPending}
                  >
                    {deleteProgramMut.isPending ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
              open={deletingOuting !== null}
              onOpenChange={(next) => {
                if (!next) {
                  setDeletingOuting(null);
                }
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this outing?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{deletingOuting?.title}” is removed permanently, along with
                    any volunteer count and service hours recorded against it —
                    the totals on this page will drop accordingly.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void confirmDeleteOuting();
                    }}
                    disabled={deleteOutingMut.isPending}
                  >
                    {deleteOutingMut.isPending ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </main>
    </>
  );
}
