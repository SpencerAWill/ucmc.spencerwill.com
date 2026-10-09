import { render } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Render a component that contains `<Link>`s.
 *
 * TanStack Router's `<Link>` reads router context and throws outside a
 * `RouterProvider`, so any component rendering one is untestable with a
 * bare `render()`. This mounts the tree under a throwaway memory router
 * whose single root route renders it.
 *
 * It lives in `src/test-support/` rather than beside one test because
 * it is the answer for every such component, and the alternative — each
 * test either hand-rolling a router or the component being downgraded
 * to `<button>` so it can be tested — is how a codebase ends up with
 * list rows that can't be middle-clicked or copied.
 *
 * **Hrefs are real and assertable**; navigation is not exercised. The
 * routes a link points at are not registered here, so
 * `expect(link).toHaveAttribute("href", "/calendar/abc")` works while
 * clicking it does nothing. That is the right boundary for a component
 * test: where a link goes is the component's business, what happens
 * next is the router's.
 */
export async function renderWithRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  // `RouterProvider` renders nothing until the router has resolved its
  // initial match, so a synchronous `render()` returns an empty body
  // and every query misses. Awaiting the load is what makes this
  // usable from an ordinary (async) test.
  await router.load();

  return render(
    // The generated route tree types `RouterProvider`'s `router` to the
    // app's own router; this throwaway one is structurally different by
    // design, and typing it properly would mean registering every real
    // route just to render one component.
    <RouterProvider router={router as never} />,
  );
}
