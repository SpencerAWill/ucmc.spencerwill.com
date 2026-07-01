import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for `/gazette/*`. Mirrors the gear.tsx pattern: the
 * list page lives at `gazette.index.tsx` and the detail page at
 * `gazette.$publicId.tsx`, both as children that mount into the
 * `<Outlet />` rendered here. Without this layout, navigating from
 * /gazette to /gazette/$publicId would re-render the list page
 * because TanStack's file router would treat the index as the
 * parent and have no slot for the child component.
 *
 * No view-permission guard here — both children carry their own
 * `requireViewPermission("public_gazette:view")` in beforeLoad so
 * the guard runs in the same place for direct navigations as for
 * sub-route transitions.
 */
export const Route = createFileRoute("/gazette")({
  component: GazetteLayout,
});

function GazetteLayout() {
  return <Outlet />;
}
