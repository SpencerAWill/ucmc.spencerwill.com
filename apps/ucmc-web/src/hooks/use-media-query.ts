import * as React from "react";

/**
 * Subscribe to a CSS media query.
 *
 * Returns `false` until mounted, which is the correct SSR answer for
 * every current caller: the pointer/hover and reduced-motion queries
 * this exists for describe the *device*, and the server has no device.
 * Rendering the no-capability branch first and upgrading on mount also
 * keeps hydration stable — the alternative (guessing on the server) is a
 * mismatch every time the guess is wrong.
 *
 * `useIsMobile` predates this and keeps its own implementation: it reads
 * `window.innerWidth` rather than the query's own match state, so it is
 * not simply this hook with a breakpoint string.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Whether the visitor has a hover-capable, precise pointer — a mouse or
 * trackpad, not a touchscreen. Hover-revealed affordances need this:
 * on a touch device they'd either never appear or appear stuck after a
 * tap, so those controls are simply not offered there.
 */
export const POINTER_FINE_QUERY = "(hover: hover) and (pointer: fine)";

/** Whether the visitor asked the OS to reduce motion (WCAG 2.3.3). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
