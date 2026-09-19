import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "#/components/layouts/page-container";
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
import { requirePageEnabled } from "#/features/settings/api/page-guards";
import { publicSiteContactQueryOptions } from "#/features/settings/api/queries";
import { sponsorsContentQueryOptions } from "#/features/sponsors/api/queries";
import { useDeleteSponsor } from "#/features/sponsors/api/use-sponsor-mutations";
import { BecomeASponsor } from "#/features/sponsors/components/become-a-sponsor";
import { SponsorFormDialog } from "#/features/sponsors/components/sponsor-form-dialog";
import type { SponsorFormSeed } from "#/features/sponsors/components/sponsor-form-dialog";
import { SponsorGrid } from "#/features/sponsors/components/sponsor-grid";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";
import { markdownPageQueryOptions } from "#/server/markdown-pages/queries";

/**
 * Public /sponsors page (#185). Two readers, one page: a member or
 * visitor asking who backs this club (and, if they're a member, what
 * that gets them), and a business deciding whether to be next.
 *
 * Gated by `public_sponsors:view` through `requirePageEnabled`, which
 * honours the role_anonymous permission set — visible to signed-out
 * visitors while that grant stands, and to every approved member via
 * role_member's. Non-holders get the notFound boundary rather than a
 * redirect: a deep link without permission means "this page is invisible
 * to you", not "the link is broken".
 *
 * Three permissions are in play and they do different jobs.
 * `public_sponsors:manage` gates every edit affordance here and every
 * write at the action layer. `public_sponsors:perks` decides whether
 * member-only perk text is rendered — the server has already stripped it
 * from the payload for a viewer without the grant, and this second check
 * is what makes role preview narrow the page (the server always answers
 * the real principal, so a sys admin previewing `anonymous` still
 * receives the perks and must not show them).
 */
export const Route = createFileRoute("/sponsors")({
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(
      context.queryClient,
      "sponsors",
      "public_sponsors:view",
    );
  },
  loader: async ({ context }) => {
    // The hero paints first, so it's prefetched alongside the page's own
    // data rather than fetched after hydration — otherwise the band
    // shows registry defaults and swaps once the query lands.
    await Promise.all([
      context.queryClient.ensureQueryData(sponsorsContentQueryOptions()),
      context.queryClient.ensureQueryData(markdownPageQueryOptions("sponsors")),
      context.queryClient.ensureQueryData(
        markdownPageQueryOptions("sponsors_pitch"),
      ),
      context.queryClient.ensureQueryData(pageHeroQueryOptions("sponsors")),
    ]);
  },
  component: SponsorsPage,
});

function SponsorsPage() {
  const { data } = useSuspenseQuery(sponsorsContentQueryOptions());
  // Both markdown bands are their own cache entries, not part of the
  // bundle above: `useUpdateMarkdownPage` invalidates
  // `["markdown-page", slug]` and nothing else, so a copy in the bundle
  // would still render pre-save text after a save — and would then seed
  // the sheet's next edit, silently overwriting it.
  const { data: intro } = useSuspenseQuery(
    markdownPageQueryOptions("sponsors"),
  );
  const { data: pitch } = useSuspenseQuery(
    markdownPageQueryOptions("sponsors_pitch"),
  );
  const { data: contact } = useQuery(publicSiteContactQueryOptions());
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_sponsors:manage");
  const canSeePerks = hasPermission("public_sponsors:perks");

  const [editIntroOpen, setEditIntroOpen] = useState(false);
  const [editPitchOpen, setEditPitchOpen] = useState(false);
  const [sponsorSeed, setSponsorSeed] = useState<SponsorFormSeed | null>(null);
  const [deleting, setDeleting] = useState<SponsorEntry | null>(null);

  const deleteMut = useDeleteSponsor();

  async function confirmDelete() {
    if (deleting === null) {
      return;
    }
    try {
      await deleteMut.mutateAsync({ id: deleting.id });
      toast.success("Sponsor removed.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't remove the sponsor.",
      );
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHero page="sponsors" />
      <PageContainer width="prose" className="space-y-10">
        {canManage ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditIntroOpen(true)}
              aria-label="Edit sponsors introduction"
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          </div>
        ) : null}

        {intro.markdown.length > 0 ? (
          <MarkdownContent>{intro.markdown}</MarkdownContent>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Who backs us
            </h2>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSponsorSeed({ mode: "create" })}
                aria-label="Add sponsor"
              >
                <Plus className="size-4" />
                Add sponsor
              </Button>
            ) : null}
          </div>
          <SponsorGrid
            sponsors={data.sponsors}
            canSeePerks={canSeePerks}
            canManage={canManage}
            onEdit={(sponsor) => setSponsorSeed({ mode: "edit", sponsor })}
            onDelete={setDeleting}
          />
        </section>

        <section className="space-y-3">
          {canManage ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditPitchOpen(true)}
                aria-label="Edit sponsorship pitch"
              >
                <Pencil className="size-4" />
                Edit pitch
              </Button>
            </div>
          ) : null}
          <BecomeASponsor
            markdown={pitch.markdown}
            clubEmail={contact?.clubEmail}
          />
        </section>

        {canManage ? (
          <>
            <EditMarkdownSheet
              slug="sponsors"
              title="Edit sponsors introduction"
              description="What sponsorship means for the club, above the sponsor list. Renders as markdown — headings (##), bold, italic, links, and lists are all supported."
              open={editIntroOpen}
              onOpenChange={setEditIntroOpen}
              initialMarkdown={intro.markdown}
              fieldLabel="Introduction"
              placeholder="Why these businesses matter to us…"
            />
            <EditMarkdownSheet
              slug="sponsors_pitch"
              title="Edit sponsorship pitch"
              description="The case a prospective sponsor reads before deciding to write in. Renders as markdown."
              open={editPitchOpen}
              onOpenChange={setEditPitchOpen}
              initialMarkdown={pitch.markdown}
              fieldLabel="Pitch"
              placeholder="What a sponsor gets…"
            />
            <SponsorFormDialog
              seed={sponsorSeed}
              canSeePerks={canSeePerks}
              onClose={() => setSponsorSeed(null)}
            />

            <AlertDialog
              open={deleting !== null}
              onOpenChange={(next) => {
                if (!next) {
                  setDeleting(null);
                }
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this sponsor?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{deleting?.name}” stops appearing on this page, and their
                    uploaded logo is deleted. Nothing else references a sponsor,
                    so nothing else changes.
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
                    {deleteMut.isPending ? "Removing…" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </PageContainer>
    </>
  );
}
