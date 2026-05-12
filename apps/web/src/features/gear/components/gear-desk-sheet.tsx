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
 * and check-in flows, with a tab toggle at the top. Opens from a
 * single always-visible "Gear desk" button in the page header
 * (`GearDeskTrigger`) which adapts responsively — icon-only on narrow
 * widths, icon + label on `sm` and up. An earlier mobile-FAB iteration
 * was dropped because the FAB's fixed positioning fought with the
 * sidebar's stacking context.
 *
 * Selection state lives inside each pane and resets when the Sheet
 * closes; switching modes within the same open session intentionally
 * preserves the pane state on the other side so an officer can
 * jump back and forth (e.g. take three returns, then check out
 * something else) without losing what they typed.
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
          <SheetTitle>Gear desk</SheetTitle>
          <SheetDescription>
            Scan or search to check gear in and out at the cave.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          className="mt-2"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="checkout">Check out</TabsTrigger>
            <TabsTrigger value="checkin">Check in</TabsTrigger>
          </TabsList>
        </Tabs>
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
