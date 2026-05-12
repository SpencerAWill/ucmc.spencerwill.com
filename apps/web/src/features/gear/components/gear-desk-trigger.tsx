import { Inbox } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { GearDeskSheet } from "#/features/gear/components/gear-desk-sheet";

/**
 * Single component that renders BOTH the desktop header button AND a
 * mobile floating action button, opening the same Sheet. Renders
 * nothing if the caller hasn't passed `canLoan` (the parent route
 * does the permission check so the cost of the lazy-loaded scanner
 * never ships to non-officers).
 *
 * Render position:
 *   - inline (desktop): a regular Button at the page header. Hidden
 *     on small screens.
 *   - fixed FAB (mobile): bottom-right, visible only on small
 *     screens. Sized for thumb reach.
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
        className={cn("hidden sm:inline-flex", className)}
      >
        <Inbox className="size-4" />
        Gear desk
      </Button>
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        // Mobile FAB. `bottom-6 right-6` clears the iOS home indicator
        // on most devices; `safe-area-inset` could be added later if
        // we ever feel it on tested hardware.
        className="fixed bottom-6 right-6 z-30 size-14 rounded-full shadow-lg sm:hidden"
        aria-label="Open gear desk"
      >
        <Inbox className="size-6" />
      </Button>
      <GearDeskSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
