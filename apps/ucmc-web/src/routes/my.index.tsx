import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Bare `/my` has no page of its own — it's a namespace. Redirect to the
 * profile tab so anyone who trims the URL, or follows an old `/my`
 * bookmark, lands somewhere real instead of on the parent layout's empty
 * outlet.
 *
 * Deliberately unconditional: it does *not* consult `pages.my_profile`.
 * A redirect into a killed page still 404s at the destination, which is
 * the honest outcome — branching here would just move the same 404 one
 * hop earlier while adding a flag read to every `/my` hit. When
 * `/my/dashboard` ships this is the line that should point at it.
 */
export const Route = createFileRoute("/my/")({
  beforeLoad: () => {
    throw redirect({ to: "/my/profile" });
  },
});
