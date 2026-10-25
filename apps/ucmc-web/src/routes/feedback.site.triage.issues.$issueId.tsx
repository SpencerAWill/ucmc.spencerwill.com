import { createFileRoute } from "@tanstack/react-router";

import { requirePermission } from "#/features/auth/guards";

/**
 * Placeholder so the triage inbox can link to its composer with typed
 * params. Task 14 replaces this with the real composer.
 */
export const Route = createFileRoute("/feedback/site/triage/issues/$issueId")({
  beforeLoad: async ({ context, location }) => {
    await requirePermission({ context, location }, "site_feedback:manage");
  },
  component: () => <p className="text-sm text-muted-foreground">Composer</p>,
});
