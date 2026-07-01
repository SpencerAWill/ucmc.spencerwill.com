import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "#/components/ui/button";
import { requireCurrentWaiver } from "#/features/auth/guards";
import { MyCartList } from "#/features/gear/components/my-cart-list";

/**
 * Member's gear cart at `/my/gear/cart`. The parent `/my` guard already
 * requires approved + profile-complete; we layer `requireCurrentWaiver`
 * here so a waiver-lapsed member can't sit in this route and build a
 * cart they couldn't act on at the desk. The route guard bounces them
 * to /my/account/waiver; the server-fn gate ([requireCartMember])
 * catches direct calls.
 */
export const Route = createFileRoute("/my/gear/cart")({
  beforeLoad: async ({ context, location }) => {
    await requireCurrentWaiver(context.queryClient, location.href);
  },
  component: MyCartPage,
});

function MyCartPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/my/gear">
            <ArrowLeft className="size-4" />
            Back to my gear
          </Link>
        </Button>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">My cart</h1>
          <p className="text-sm text-muted-foreground">
            Build a list of gear you'd like to check out, then show the QR code
            at the gear cave so the manager can pre-fill your checkout.
          </p>
        </header>
      </div>
      <MyCartList />
    </div>
  );
}
