import { createFileRoute } from "@tanstack/react-router";

import { MyGearList } from "#/features/gear/components/my-gear-list";

/**
 * Member's own gear page. The `/my` parent route guards on
 * `requireApproved`; we don't gate on `gear:read` here because the
 * server fn `listMyLoansAction` only requires `gear:read` and any
 * approved member should have it via the default role grant. If a
 * future role strips `gear:read`, the empty state still renders
 * gracefully because the loader doesn't throw.
 */
export const Route = createFileRoute("/my/gear")({
  component: MyGearPage,
});

function MyGearPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My gear</h1>
        <p className="text-sm text-muted-foreground">
          Equipment you've checked out from the gear cave.
        </p>
      </header>
      <MyGearList />
    </div>
  );
}
