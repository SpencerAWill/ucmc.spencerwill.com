/**
 * Browse by model: one card per product, with its units bucketed.
 *
 * This is what the whole type → model → item rework was for. The flat
 * item list answers "where is CH93", which is an officer's question. A
 * member asks "does the club have a harness I can borrow on Saturday",
 * and twelve unrelated rows all reading "Black Diamond HotForge"
 * cannot answer it — the number they want is "7 of 12 available", and
 * before the model layer nothing in the data could produce it.
 *
 * Coded and counted models are shown identically on purpose. Whether
 * the cave tracks a product unit by unit or by the binful is a
 * bookkeeping decision, and a member borrowing six draws has no reason
 * to learn about it.
 */
import { useQuery } from "@tanstack/react-query";

import { Badge } from "#/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "#/components/ui/empty";
import { Item, ItemContent, ItemMedia } from "#/components/ui/item";
import { Skeleton } from "#/components/ui/skeleton";
import { gearModelBrowseQueryOptions } from "#/features/gear/api/queries";
import { formatAttributeValue } from "#/features/gear/lib/attributes";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type { GearModelBrowseDto } from "#/features/gear/server/gear-fns";

export function GearModelBrowse({
  typePublicId,
  q,
  onPick,
}: {
  typePublicId: string | null;
  q: string;
  /** Clicking a model narrows the item list to it, which is how a
   *  member gets from "7 available" to a specific code at the desk. */
  onPick: (modelPublicId: string) => void;
}) {
  const { data, isLoading } = useQuery(
    gearModelBrowseQueryOptions({ typePublicId, q }),
  );

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const models = data ?? [];
  if (models.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Nothing matches.</EmptyTitle>
          <EmptyDescription>
            Models appear here as soon as a type has one. Officers add them from
            the Models button.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {models.map((model) => (
        <ModelCard key={model.publicId} model={model} onPick={onPick} />
      ))}
    </div>
  );
}

function ModelCard({
  model,
  onPick,
}: {
  model: GearModelBrowseDto;
  onPick: (modelPublicId: string) => void;
}) {
  const thumbnail =
    model.imageKey === null ? null : gearThumbnailUrlFor(model.imageKey);
  // Counted models have no item rows, so their denominator is stock.
  const owned =
    model.tracking === "counted"
      ? model.stock.reduce((sum, s) => sum + s.quantity, 0)
      : model.total - model.retired;

  return (
    <Item variant="outline" className="items-start">
      {thumbnail ? (
        <ItemMedia>
          <img
            src={thumbnail}
            alt=""
            className="size-14 rounded object-cover"
            loading="lazy"
          />
        </ItemMedia>
      ) : null}
      <ItemContent className="gap-1.5">
        <button
          type="button"
          className="text-left font-medium hover:underline"
          onClick={() => onPick(model.publicId)}
        >
          {model.manufacturer ? `${model.manufacturer} ` : ""}
          {model.name}
        </button>
        <p className="text-xs text-muted-foreground">{model.type.name}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* The headline number, and the reason this page exists. */}
          <Badge variant={model.takeable > 0 ? "default" : "secondary"}>
            {owned === 0
              ? "None yet"
              : `${model.takeable} of ${owned} available`}
          </Badge>
          {model.onLoan > 0 ? (
            <Badge variant="outline">{model.onLoan} out</Badge>
          ) : null}
          {model.onHold > 0 ? (
            <Badge variant="outline">{model.onHold} held</Badge>
          ) : null}
          {model.unavailable > 0 ? (
            <Badge variant="destructive">
              {model.unavailable} needs attention
            </Badge>
          ) : null}
        </div>

        {model.attributes.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {model.attributes
              .map((a) => `${a.label}: ${formatAttributeValue(a) ?? "—"}`)
              .join(" · ")}
          </p>
        ) : null}
      </ItemContent>
    </Item>
  );
}
