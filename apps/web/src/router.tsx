import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { z } from "zod";
import { routeTree } from "./routeTree.gen";

import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "./lib/tanstack-query/root-provider";
import { ErrorPage } from "#/components/error-page";
import { NotFoundPage } from "#/components/not-found-page";

// Disable zod's JIT object validator. Its `new Function()`-compiled fast
// path trips our CSP `script-src` (no `'unsafe-eval'`) on every parse,
// flooding report-only violations. Setting this also short-circuits zod's
// eval-feature probe so we can flip CSP to enforce later without surprises.
z.config({ jitless: true });

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
