import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Edit, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermission } from "#/features/auth/guards";
import { gearTypesQueryOptions } from "#/features/gear/api/queries";
import { useDeleteGearType } from "#/features/gear/api/use-delete-gear-type";
import { GearTypeFormSheet } from "#/features/gear/components/gear-type-form-sheet";
import type { GearTypeFormMode } from "#/features/gear/components/gear-type-form-sheet";
import type { GearTypeSummary } from "#/features/gear/server/gear-fns";

export const Route = createFileRoute("/gear/types")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "gear:manage");
  },
  component: GearTypesPage,
});

function GearTypesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("gear:manage");
  const { data, isLoading } = useQuery(gearTypesQueryOptions());
  const [formOpen, setFormOpen] = useState(false);
  const [formIntent, setFormIntent] = useState<GearTypeFormMode>({
    mode: "create",
  });
  const [pendingDelete, setPendingDelete] = useState<GearTypeSummary | null>(
    null,
  );
  const deleteMutation = useDeleteGearType();

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    deleteMutation.mutate(
      { publicId: pendingDelete.publicId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Type "${pendingDelete.name}" deleted`);
            setPendingDelete(null);
          } else {
            toast.error(
              "Can't delete — gear still references this type. Retire or move pieces first.",
            );
          }
        },
        onError: () => toast.error("Couldn't delete."),
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/gear">
            <ArrowLeft className="size-4" />
            Back to gear
          </Link>
        </Button>
        {canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setFormIntent({ mode: "create" });
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New type
          </Button>
        ) : null}
      </div>
      <header>
        <h1 className="text-xl font-semibold">Gear types</h1>
        <p className="text-sm text-muted-foreground">
          Types partition the inventory. Prefix is a UI hint for the
          suggested-code helper.
        </p>
      </header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (data ?? []).length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              No types yet. Add one to start tracking gear.
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {(data ?? []).map((t) => (
            <li key={t.publicId}>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {t.name}
                      {t.prefix ? (
                        <Badge variant="outline" className="font-mono">
                          {t.prefix}
                        </Badge>
                      ) : null}
                    </CardTitle>
                    {t.description ? (
                      <CardDescription>{t.description}</CardDescription>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFormIntent({ mode: "edit", type: t });
                          setFormOpen(true);
                        }}
                      >
                        <Edit className="size-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(t)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="pt-0" />
              </Card>
            </li>
          ))}
        </ul>
      )}
      <GearTypeFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        intent={formIntent}
      />
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this type?</AlertDialogTitle>
            <AlertDialogDescription>
              This is blocked while any gear (active or retired) references this
              type. Retire or move pieces first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                onConfirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
