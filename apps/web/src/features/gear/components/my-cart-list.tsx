import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QrCode, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { myCartQueryOptions } from "#/features/gear/api/queries";
import { useClearCart } from "#/features/gear/api/use-clear-cart";
import { useRemoveFromCart } from "#/features/gear/api/use-remove-from-cart";
import { CartQrDialog } from "#/features/gear/components/cart-qr-dialog";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type {
  CartItemAvailability,
  CartItemRow,
} from "#/features/gear/server/gear-fns";

const PLACEHOLDER = "/gear-placeholder.svg";

const AVAILABILITY_COPY: Record<
  CartItemAvailability,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  loanable: { label: "Available", variant: "secondary" },
  on_loan: { label: "Currently on loan", variant: "destructive" },
  not_serviceable: { label: "Out for repair", variant: "destructive" },
  retired: { label: "Retired", variant: "destructive" },
  not_found: { label: "No longer in inventory", variant: "destructive" },
};

/**
 * `/my/gear/cart` body. Lists the member's cart items, lets them
 * remove individual entries / clear the whole thing, and opens a QR
 * dialog they can present at the cave for the officer to scan.
 *
 * Unavailable items aren't hidden — the member sees them flagged so
 * they know the cart "intent" survived; same vocabulary the officer
 * sees on the desk pane after a scan.
 */
export function MyCartList() {
  const { data, isLoading, isError, error } = useQuery(myCartQueryOptions());
  const remove = useRemoveFromCart();
  const clear = useClearCart();
  const [qrOpen, setQrOpen] = useState(false);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your cart…</p>;
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load your cart</AlertTitle>
        <AlertDescription>
          {error instanceof Error && error.message
            ? error.message
            : "Something went wrong. Try refreshing the page."}
        </AlertDescription>
      </Alert>
    );
  }
  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        Your cart is empty. Browse{" "}
        <Link to="/gear" className="font-medium text-primary hover:underline">
          gear
        </Link>{" "}
        to add pieces.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() =>
            clear.mutate(undefined, {
              onError: () => toast.error("Couldn't clear your cart."),
            })
          }
          disabled={clear.isPending}
        >
          <Trash2 className="size-4" />
          Clear cart
        </Button>
        <Button onClick={() => setQrOpen(true)}>
          <QrCode className="size-4" />
          Show QR at gear desk
        </Button>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <CartItemRowDisplay
            key={item.publicId}
            item={item}
            onRemove={() =>
              remove.mutate(
                { gearPublicId: item.publicId },
                {
                  onError: () => toast.error("Couldn't remove that piece."),
                },
              )
            }
          />
        ))}
      </ul>
      <CartQrDialog open={qrOpen} onOpenChange={setQrOpen} />
    </div>
  );
}

function CartItemRowDisplay({
  item,
  onRemove,
}: {
  item: CartItemRow;
  onRemove: () => void;
}) {
  const availability = AVAILABILITY_COPY[item.availability];
  const isLoanable = item.availability === "loanable";
  return (
    <li>
      <Card
        className={`overflow-hidden p-0 transition-shadow hover:shadow-md ${
          isLoanable ? "" : "border-destructive/50"
        }`}
      >
        <div className="grid grid-cols-[5rem_1fr_auto] items-center sm:grid-cols-[7rem_1fr_auto]">
          <div className="bg-muted">
            <Link to="/gear/$publicId" params={{ publicId: item.publicId }}>
              <img
                src={
                  item.thumbnailKey
                    ? gearThumbnailUrlFor(item.thumbnailKey)
                    : PLACEHOLDER
                }
                alt=""
                className="aspect-square h-full w-full object-cover"
              />
            </Link>
          </div>
          <div className="min-w-0 space-y-1 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <span className="rounded border border-primary/30 bg-primary/10 px-1.5 font-mono text-xs font-semibold text-primary">
                {item.code}
              </span>
              <Link
                to="/gear/$publicId"
                params={{ publicId: item.publicId }}
                className="truncate text-sm font-medium hover:underline"
              >
                {item.description}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">{item.typeName}</p>
            <Badge variant={availability.variant} className="text-xs">
              {availability.label}
            </Badge>
          </div>
          <div className="p-3 sm:p-4">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${item.code} from cart`}
              onClick={onRemove}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </li>
  );
}
