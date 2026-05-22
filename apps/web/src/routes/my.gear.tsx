import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Pathless layout for `/my/gear*`. TanStack file-based routing nests
 * `my.gear.cart.tsx` as a child of this route, so without an `<Outlet />`
 * here the cart page would never reach the screen at `/my/gear/cart`.
 *
 * The /my/gear page content (active loans + history) moved to
 * `my.gear.index.tsx`; the cart lives at `my.gear.cart.tsx`. The
 * approved-only guard inherited from `/my` still applies to both.
 */
export const Route = createFileRoute("/my/gear")({
  component: () => <Outlet />,
});
