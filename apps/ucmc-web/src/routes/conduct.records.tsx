import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useAuth } from "#/features/auth/api/use-auth";
import { RecordForm } from "#/features/conduct/components/record-form";
import { RecordsTable } from "#/features/conduct/components/records-table";
import { requirePageFlag } from "#/features/settings/api/page-guards";

export const Route = createFileRoute("/conduct/records")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "conduct");
  },
  component: RecordsPage,
});

function RecordsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {hasPermission("conduct:manage") ? (
        <div className="flex justify-end">
          <Button aria-haspopup="dialog" onClick={() => setCreating(true)}>
            New record
          </Button>
        </div>
      ) : null}
      <RecordsTable />
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent size="xl" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New record</SheetTitle>
            <SheetDescription>
              Choose the member and the level. Warnings, suspensions and
              terminations are sent to the member.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <RecordForm
              onCreated={(publicId) => {
                setCreating(false);
                void navigate({
                  to: "/conduct/$publicId",
                  params: { publicId },
                });
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
