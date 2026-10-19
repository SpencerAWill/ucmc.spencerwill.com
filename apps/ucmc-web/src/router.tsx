// Must be first: configures zod (jitless) before any other module
// reaches a `.parse()` call. See `./lib/zod-config` for the rationale.
import "./lib/zod-config";

// Installs the TC39 Temporal polyfill on the client's global, replacing
// any native `Temporal` the browser ships, so the client runs the same
// implementation the server rendered with (see `./lib/temporal-install`).
// Must precede any component or query that touches a Temporal value.
import "#/lib/temporal-install";

import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./lib/tanstack-query/root-provider";
import { ErrorPage } from "#/components/error-page";
import { NotFoundPage } from "#/components/not-found-page";

export function getRouter() {
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
