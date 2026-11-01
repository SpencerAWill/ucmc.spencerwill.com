import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { correctionDraftQueryOptions } from "#/features/conduct/api/queries";
import { RecordForm } from "#/features/conduct/components/record-form";

/**
 * "Correct" on a sent or active record: the record form prefilled from
 * it. Issuing the correction lifts this record and emails the member a
 * notice that says it replaces the earlier one. Rendered for
 * `conduct:manage` holders only.
 */
export function CorrectRecordSheet({ publicId }: { publicId: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const draft = useQuery({
    ...correctionDraftQueryOptions(publicId),
    enabled: open,
  });

  return (
    <>
      <Button
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Correct
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent size="xl" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Correct this record</SheetTitle>
            <SheetDescription>
              The correction replaces this record, which is lifted with no
              separate notice. The member is emailed the corrected statement.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {draft.isPending ? (
              <p className="text-sm text-muted-foreground">Loading record…</p>
            ) : draft.data ? (
              <RecordForm
                correction={{ supersedesPublicId: publicId, draft: draft.data }}
                onCreated={(newPublicId) => {
                  setOpen(false);
                  void navigate({
                    to: "/conduct/$publicId",
                    params: { publicId: newPublicId },
                  });
                }}
              />
            ) : (
              <p role="alert" className="text-sm text-destructive">
                This record can no longer be corrected.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
