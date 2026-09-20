import { useQuery } from "@tanstack/react-query";
import { Check, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useAuth } from "#/features/auth/api/use-auth";
import { myCartQueryOptions } from "#/features/gear/api/queries";
import { useAddToCart } from "#/features/gear/api/use-add-to-cart";
import {
  BLOCKED_REASON_MESSAGE,
  itemBlockedReason,
} from "#/features/gear/lib/availability";
import type { GearAvailability } from "#/features/gear/lib/availability";
import type {
  AddToCartResult,
  GearCondition,
  GearStatus,
  GearWhereabouts,
} from "#/features/gear/server/gear-fns";

type Variant = "card" | "detail";

interface AddToCartButtonProps {
  publicId: string;
  code: string | null;
  status: GearStatus;
  condition: GearCondition;
  whereabouts: GearWhereabouts;
  availability: GearAvailability;
  /** Renders compact (icon-only) on `card`, full button with label on
   *  `detail`. Both are the same component so the in-cart / disabled
   *  state logic lives in one place. */
  variant?: Variant;
}

type AddToCartFailureReason = Extract<AddToCartResult, { ok: false }>["reason"];

const REASON_COPY: Record<AddToCartFailureReason, string> = {
  not_found: "That piece is no longer in inventory.",
  retired: "That piece has been retired.",
  no_code: "Ask an officer to tag this piece before adding it to a cart.",
  already_in_cart: "Already in your cart.",
};

/**
 * Member-facing "Add to cart" affordance for /gear list cards and the
 * gear detail page. Hidden for non-approved viewers (anonymous,
 * pending, deactivated). Officers see it too — they're still members
 * of the club and may want to borrow gear themselves.
 *
 * Waiver enforcement happens server-side; clicking as a waiver-lapsed
 * member surfaces the action's error as a toast. We don't pre-check
 * the waiver here to keep the button stateless and to avoid pulling
 * waivers into the gear feature graph.
 */
export function AddToCartButton({
  publicId,
  code,
  status,
  condition,
  whereabouts,
  availability,
  variant = "card",
}: AddToCartButtonProps) {
  const { principal } = useAuth();
  const cart = useQuery({
    ...myCartQueryOptions(),
    // Only fetch the cart when there's a chance the button will render
    // (signed-in approved member). The cart action 403s for waiver-
    // lapsed members so we'd burn an error otherwise; gracefully fall
    // through to "show the button anyway" — the click handler is the
    // source of truth.
    enabled: principal?.status === "approved",
    retry: false,
  });
  const add = useAddToCart();

  if (!principal || principal.status !== "approved") {
    return null;
  }
  // Any terminal status hides the control outright, not just `retired`
  // — a lost or disposed piece is not a thing the club is lending, and
  // an explanation of why you can't borrow it is noise on every row of
  // a filtered-to-retired list.
  if (status !== "active") {
    return null;
  }

  const inCart = cart.data?.items.some((i) => i.publicId === publicId) ?? false;
  // Everything short of terminal keeps its control and says why. A
  // control that silently isn't there is the same dead end as a
  // greyed-out one with no explanation, which is exactly what these
  // messages were written to avoid.
  const blocked = inCart
    ? null
    : itemBlockedReason({ status, condition, whereabouts, availability, code });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    add.mutate(
      { gearPublicId: publicId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Added ${code} to your cart.`);
            return;
          }
          toast.error(REASON_COPY[result.reason]);
        },
        onError: (err: unknown) => {
          toast.error(
            err instanceof Error && err.message
              ? err.message
              : "Couldn't add to cart.",
          );
        },
      },
    );
  };

  if (variant === "detail") {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          variant={inCart ? "outline" : "default"}
          size="sm"
          onClick={handleClick}
          disabled={inCart || blocked !== null || add.isPending}
        >
          {inCart ? (
            <>
              <Check className="size-4" />
              In your cart
            </>
          ) : (
            <>
              <ShoppingCart className="size-4" />
              Add to cart
            </>
          )}
        </Button>
        {blocked ? (
          <p className="max-w-60 text-xs text-muted-foreground">
            {BLOCKED_REASON_MESSAGE[blocked]}
          </p>
        ) : null}
      </div>
    );
  }

  const label = inCart
    ? `${code} is in your cart`
    : blocked
      ? `Can't add ${code ?? "this piece"}: ${BLOCKED_REASON_MESSAGE[blocked]}`
      : `Add ${code} to cart`;

  const button = (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={label}
      onClick={handleClick}
      disabled={inCart || blocked !== null || add.isPending}
    >
      {inCart ? (
        <Check className="size-4 text-primary" />
      ) : (
        <ShoppingCart className="size-4" />
      )}
    </Button>
  );

  if (!blocked) {
    return button;
  }

  // A disabled button swallows pointer events, so the tooltip hangs off
  // a focusable wrapper rather than the button itself. The reason is
  // already in the accessible name above, for anyone who never hovers.
  return (
    // Owns its provider for the same reason `DataToolbar` does: the
    // app's only one comes from `SidebarProvider`, so a card rendered in
    // a test or a story would throw. Nesting inside the sidebar's is
    // harmless.
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{BLOCKED_REASON_MESSAGE[blocked]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
