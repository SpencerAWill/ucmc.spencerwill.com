import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Edit, Printer, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { gearDetailQueryOptions } from "#/features/gear/api/queries";
import { useUnretireGear } from "#/features/gear/api/use-unretire-gear";
import { AddToCartButton } from "#/features/gear/components/add-to-cart-button";
import { GearDetailCard } from "#/features/gear/components/gear-detail-card";
import { GearFormSheet } from "#/features/gear/components/gear-form-sheet";
import { GearInspectionsSection } from "#/features/gear/components/gear-inspections-section";
import { GearLabelsDialog } from "#/features/gear/components/gear-labels-dialog";
import { GearRetireDialog } from "#/features/gear/components/gear-retire-dialog";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

export const Route = createFileRoute("/gear/$publicId")({
  staticData: { pageFlag: "gear_detail" },
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
  },
  component: GearDetailPage,
});

function GearDetailPage() {
  const { publicId } = Route.useParams();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("gear:manage");
  const { data, isLoading, error } = useQuery(gearDetailQueryOptions(publicId));
  const [editOpen, setEditOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const unretire = useUnretireGear();

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <p className="text-sm text-muted-foreground">Gear not found.</p>
        <Button asChild variant="ghost" size="sm" className="mt-2">
          <Link to="/gear">
            <ArrowLeft className="size-4" />
            Back to gear
          </Link>
        </Button>
      </div>
    );
  }
  const isRetired = data.lifecycle === "retired";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/gear">
            <ArrowLeft className="size-4" />
            Back to gear
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <AddToCartButton
            publicId={publicId}
            code={data.code}
            lifecycle={data.lifecycle}
            variant="detail"
          />
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            {data.code ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLabelsOpen(true)}
              >
                <Printer className="size-4" />
                Print label
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <Edit className="size-4" />
              Edit
            </Button>
            {isRetired ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  unretire.mutate(
                    { publicId },
                    {
                      onSuccess: () => toast.success("Gear unretired"),
                      onError: () => toast.error("Couldn't unretire."),
                    },
                  )
                }
              >
                <RotateCcw className="size-4" />
                Unretire
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setRetiring(true)}
              >
                <Trash2 className="size-4" />
                Retire
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <GearDetailCard gear={data} canManage={canManage} />
      <GearInspectionsSection gear={data} canManage={canManage} />
      {canManage ? (
        <>
          <GearLabelsDialog
            publicIds={[publicId]}
            open={labelsOpen}
            onOpenChange={setLabelsOpen}
          />
          <GearFormSheet
            open={editOpen}
            onOpenChange={setEditOpen}
            intent={{ mode: "edit", gear: data }}
          />
          <GearRetireDialog
            gear={retiring ? data : null}
            onOpenChange={(o) => {
              if (!o) setRetiring(false);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
