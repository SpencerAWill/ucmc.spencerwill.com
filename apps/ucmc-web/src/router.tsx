// Must be first: configures zod (jitless) before any other module
// reaches a `.parse()` call. See `./lib/zod-config` for the rationale.
import "./lib/zod-config";

// Installs the TC39 Temporal global on the client. Safari < 17 and other
// not-yet-native browsers have no `Temporal`; this patches it in before
// any component or query touches a Temporal value.
import "temporal-polyfill/global";

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
