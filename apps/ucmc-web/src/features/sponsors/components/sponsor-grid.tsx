import { ExternalLink, GripVertical, Pencil, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "#/components/ui/sortable";
import { useReorderSponsors } from "#/features/sponsors/api/use-sponsor-mutations";
import { SponsorLogo } from "#/features/sponsors/components/sponsor-logo";
import { sponsorWebsiteHref } from "#/features/sponsors/lib/sponsor-links";
import type { SponsorEntry } from "#/features/sponsors/server/sponsor-fns";

/**
 * The sponsor grid, and — for a `public_sponsors:manage` holder — the
 * draggable list that replaces it.
 *
 * Same shape-switch as /volunteer's programs and /history's honorary
 * members: a two-dimensional grid can't carry a drag handle without the
 * drop targets becoming ambiguous, so managing collapses to one column.
 *
 * **`canSeePerks` is passed in, never inferred from `sponsor.memberPerk`
 * being present.** The server strips the column for a viewer without
 * `public_sponsors:perks`, so presence and permission agree for a real
 * viewer — but they diverge under role emulation, where the server
 * answers the real principal and a sys admin previewing `anonymous`
 * would still be handed every perk. Asking the caller's `hasPermission`
 * result is what makes the preview narrow this page the way it narrows
 * the sidebar.
 */
export function SponsorGrid({
  sponsors,
  canSeePerks,
  canManage = false,
  onEdit,
  onDelete,
}: {
  sponsors: SponsorEntry[];
  canSeePerks: boolean;
  canManage?: boolean;
  onEdit?: (sponsor: SponsorEntry) => void;
  onDelete?: (sponsor: SponsorEntry) => void;
}) {
  if (sponsors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No sponsors listed yet.</p>
    );
  }
  if (!canManage) {
    return (
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {sponsors.map((sponsor) => (
          <li key={sponsor.id}>
            <SponsorCard sponsor={sponsor} canSeePerks={canSeePerks} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <SortableSponsorList
      sponsors={sponsors}
      canSeePerks={canSeePerks}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function SponsorCard({
  sponsor,
  canSeePerks,
}: {
  sponsor: SponsorEntry;
  canSeePerks: boolean;
}) {
  const href = sponsorWebsiteHref(sponsor);
  return (
    <Card className="h-full">
      <CardContent className="space-y-3 pt-6">
        <SponsorLogo
          name={sponsor.name}
          logoKey={sponsor.logoKey}
          widthPx={sponsor.logoWidthPx}
          heightPx={sponsor.logoHeightPx}
        />
        <div className="space-y-1">
          <h3 className="font-semibold leading-tight">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {sponsor.name}
                <ExternalLink
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </a>
            ) : (
              sponsor.name
            )}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {sponsor.blurb}
          </p>
        </div>
        <SponsorPerk sponsor={sponsor} canSeePerks={canSeePerks} />
      </CardContent>
    </Card>
  );
}

/**
 * The member-only block. Renders nothing unless the viewer holds
 * `public_sponsors:perks` *and* this sponsor actually offers something —
 * a sponsor with no perk gets no empty heading.
 *
 * Labelled "Members" in the open, because the perk is worth joining for
 * and a visitor reading the card should be able to tell there is
 * something here they aren't seeing.
 */
function SponsorPerk({
  sponsor,
  canSeePerks,
}: {
  sponsor: SponsorEntry;
  canSeePerks: boolean;
}) {
  if (!canSeePerks || !sponsor.memberPerk) {
    return null;
  }
  return (
    <div className="flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <Tag className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Members
        </p>
        <p className="text-sm leading-relaxed">{sponsor.memberPerk}</p>
      </div>
    </div>
  );
}

function SortableSponsorList({
  sponsors,
  canSeePerks,
  onEdit,
  onDelete,
}: {
  sponsors: SponsorEntry[];
  canSeePerks: boolean;
  onEdit?: (sponsor: SponsorEntry) => void;
  onDelete?: (sponsor: SponsorEntry) => void;
}) {
  const reorder = useReorderSponsors();

  // Optimistic local copy so a drop snaps immediately rather than
  // waiting on the round-trip. Keyed on the joined ids rather than the
  // array reference: resync when the server's membership or ordering
  // actually changes, not on every parent re-render.
  const [items, setItems] = useState<SponsorEntry[]>(sponsors);
  const idsKey = sponsors.map((s) => s.id).join(",");
  useEffect(() => {
    setItems(sponsors);
  }, [idsKey, sponsors]);

  async function handleReorder(next: SponsorEntry[]) {
    setItems(next);
    try {
      await reorder.mutateAsync({ ids: next.map((s) => s.id) });
    } catch (err) {
      setItems(sponsors);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the new order.",
      );
    }
  }

  return (
    <Sortable
      value={items}
      onValueChange={(next) => void handleReorder(next)}
      getItemValue={(s) => s.id}
    >
      <SortableContent asChild>
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card/40">
          {items.map((sponsor) => (
            <SortableItem key={sponsor.id} value={sponsor.id} asChild>
              <li className="flex items-start gap-3 px-3 py-3">
                <SortableItemHandle asChild>
                  <button
                    type="button"
                    className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                    aria-label={`Drag to reorder ${sponsor.name}`}
                  >
                    <GripVertical className="size-4" />
                  </button>
                </SortableItemHandle>
                <SponsorLogo
                  name={sponsor.name}
                  logoKey={sponsor.logoKey}
                  widthPx={sponsor.logoWidthPx}
                  heightPx={sponsor.logoHeightPx}
                  className="h-12 w-24 shrink-0 p-2"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium leading-tight">{sponsor.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {sponsor.blurb}
                  </p>
                  {canSeePerks && sponsor.memberPerk ? (
                    <p className="text-sm text-primary">
                      Members: {sponsor.memberPerk}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {onEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Edit ${sponsor.name}`}
                      onClick={() => onEdit(sponsor)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  ) : null}
                  {onDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Delete ${sponsor.name}`}
                      onClick={() => onDelete(sponsor)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </li>
            </SortableItem>
          ))}
        </ul>
      </SortableContent>
    </Sortable>
  );
}
