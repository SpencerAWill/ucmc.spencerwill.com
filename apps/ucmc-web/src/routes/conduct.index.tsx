import { createFileRoute, redirect } from "@tanstack/react-router";

import {
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";

/**
 * Exec lands on the reports to triage; `conduct:view` holders without
 * `conduct:manage` land on the records. The layout has already required
 * `conduct:view`.
 */
export const Route = createFileRoute("/conduct/")({
  beforeLoad: async ({ context, location }) => {
    const principal = await requireApproved({ context, location });
    const granted = await effectivePermissionsFor(
      context.queryClient,
      principal,
    );
    throw redirect({
      to: granted.includes("conduct:manage")
        ? "/conduct/reports"
        : "/conduct/records",
      replace: true,
    });
  },
});
