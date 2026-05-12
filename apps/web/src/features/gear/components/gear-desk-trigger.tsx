import { Inbox } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { GearDeskSheet } from "#/features/gear/components/gear-desk-sheet";

/**
 * Header button that opens the gear-desk Sheet. Single button that
 * adapts responsively — icon-only on narrow screens, icon + label on
 * sm and up. Earlier iterations used a separate fixed-position FAB
 * for mobile, but the fixed positioning fought with the mobile
 * sidebar's stacking context and the FAB was being eaten by overlay
 * layers; an always-visible header button is simpler and consistent
 * with how other officer actions surface on this codebase.
 */
export function GearDeskTrigger({
  className,
  canLoan,
}: {
  className?: string;
  canLoan: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canLoan) return null;
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className={cn(className)}
        aria-label="Open gear desk"
      >
        <Inbox className="size-4" />
        <span className="hidden sm:inline">Gear desk</span>
      </Button>
      <GearDeskSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
