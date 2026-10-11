import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { GearDeskCheckinPane } from "#/features/gear/components/gear-desk-checkin-pane";
import { GearDeskCheckoutPane } from "#/features/gear/components/gear-desk-checkout-pane";

type Mode = "checkout" | "checkin";

/**
 * Gear-cave action surface — one Sheet that hosts both the checkout
 * and check-in flows, with a compact Check out / Check in switch on the
 * header row beside the title. Opens from a
 * single always-visible "Gear desk" button in the page header
 * (`GearDeskTrigger`) which adapts responsively — icon-only on narrow
 * widths, icon + label on `sm` and up. An earlier mobile-FAB iteration
 * was dropped because the FAB's fixed positioning fought with the
 * sidebar's stacking context.
 *
 * Selection state lives inside each pane and is lost when the pane
 * unmounts — on close, and on switching modes, since only the active
 * pane is rendered. (An earlier note here claimed the other side's state
 * survived a switch; it never did.) Mounting both would keep it, but
 * would also mount two scan columns: two wedge listeners and, with the
 * camera on, two streams.
 */
export function GearDeskSheet({
  open,
  onOpenChange,
  initialMode = "checkout",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  // Close handler also auto-closes on a successful submit (no skipped
  // rows). Panes call `onSuccess` for that path.
  const handleSuccess = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Wider on desktop so the inline scanner viewfinder and items
        // list can sit side-by-side. The panes stack to a single
        // column on narrow viewports — see their grid breakpoints.
        //
        // No `pt-*`: `position: sticky; top: 0` pins to the inside of
        // the scroll container's padding-top, so any value here would
        // offset the sticky scanner away from the actual viewport top.
        // SheetHeader has its own `p-4` so the title still gets the
        // spacing it needs.
        className="w-full overflow-y-auto px-4 pb-6 sm:max-w-3xl"
      >
        <SheetHeader className="px-0">
          {/* Title and mode on one row. The mode switch used to be a
              full-width tab bar of its own under the description — a
              whole row of the Sheet for two words, on the screen where
              vertical space matters most. `pr-8` clears the Sheet's
              close button, which sits absolutely in the top-right
              corner; `flex-wrap` lets the switch drop under the title
              rather than collide with it if a phone is narrower still. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pr-8">
            <SheetTitle>Gear desk</SheetTitle>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="h-8">
                <TabsTrigger value="checkout" className="px-2.5 text-xs">
                  Check out
                </TabsTrigger>
                <TabsTrigger value="checkin" className="px-2.5 text-xs">
                  Check in
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <SheetDescription>
            Scan or search to check gear in and out at the cave.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {mode === "checkout" ? (
            <GearDeskCheckoutPane onSuccess={handleSuccess} />
          ) : (
            <GearDeskCheckinPane onSuccess={handleSuccess} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
