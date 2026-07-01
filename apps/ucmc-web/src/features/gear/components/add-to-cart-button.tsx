import { useQuery } from "@tanstack/react-query";
import { Check, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { myCartQueryOptions } from "#/features/gear/api/queries";
import { useAddToCart } from "#/features/gear/api/use-add-to-cart";
import type { AddToCartResult } from "#/features/gear/server/gear-fns";

type Variant = "card" | "detail";

interface AddToCartButtonProps {
  publicId: string;
  code: string | null;
  lifecycle: "active" | "retired";
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
  lifecycle,
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
  if (lifecycle === "retired") {
    return null;
  }
  if (code === null) {
    // Same reason addToCartAction would reject — surface inline so the
    // button doesn't dead-end on a toast.
    return null;
  }

  const inCart = cart.data?.items.some((i) => i.publicId === publicId) ?? false;

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
      <Button
        variant={inCart ? "outline" : "default"}
        size="sm"
        onClick={handleClick}
        disabled={inCart || add.isPending}
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
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={inCart ? `${code} is in your cart` : `Add ${code} to cart`}
      onClick={handleClick}
      disabled={inCart || add.isPending}
    >
      {inCart ? (
        <Check className="size-4 text-primary" />
      ) : (
        <ShoppingCart className="size-4" />
      )}
    </Button>
  );
}
