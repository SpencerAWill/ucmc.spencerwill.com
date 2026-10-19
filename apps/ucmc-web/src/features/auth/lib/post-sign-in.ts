import type { ConsumeMagicLinkResult } from "#/features/auth/server/server-fns";
import { safeReturnPath } from "#/lib/safe-return-path";

/**
 * Where a just-authenticated visitor goes next, as an href for
 * `navigate({ href })`. The one decision table behind `/auth/callback`,
 * both passkey sign-in paths and the registration form's submit — four
 * copies of it had drifted on whether the return path was carried.
 *
 *   no profile yet  → /register/profile?redirect=<returnTo>
 *   not approved    → /register/pending?redirect=<returnTo>
 *   approved        → <returnTo> ?? home
 *
 * The return path rides through the funnel as far as `/register/pending`
 * and stops there: approval can take days, so the pending page offers it
 * as a link rather than holding on to it.
 *
 * `returnTo` is re-checked with `safeReturnPath` here, so callers can
 * hand over whatever arrived in a search param.
 */
export function postSignInHref(
  account: { hasProfile: boolean; status: string },
  returnTo: string | undefined,
  home = "/",
): string {
  const returnPath = safeReturnPath(returnTo);
  if (account.hasProfile && account.status === "approved") {
    return returnPath ?? home;
  }
  const funnel = account.hasProfile ? "/register/pending" : "/register/profile";
  return returnPath === null
    ? funnel
    : `${funnel}?${new URLSearchParams({ redirect: returnPath }).toString()}`;
}

/**
 * `/auth/callback`'s destination for a consumed link. A first-time
 * registrant (`mode: "proof"`) has no account yet, so no profile — the
 * same row of the table as a session without one.
 */
export function callbackHref(
  result: Extract<ConsumeMagicLinkResult, { ok: true }>,
  returnTo: string | undefined,
): string {
  return postSignInHref(
    result.mode === "session"
      ? result
      : { hasProfile: false, status: "pending" },
    returnTo,
  );
}

/** Pages a return path should never point back at: the sign-in flow
 *  itself, where returning would only restart it. */
const SIGN_IN_FLOW_PREFIXES = [
  "/sign-in",
  "/auth/",
  "/register/",
  "/verify-email",
];

/**
 * The return path for a "Sign in" link on the page at `pathname` +
 * `searchStr`, or `undefined` where there is nothing worth returning to
 * — home, or a page inside the sign-in flow.
 */
export function signInReturnPath(
  pathname: string,
  searchStr: string,
): string | undefined {
  if (
    pathname === "/" ||
    SIGN_IN_FLOW_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return undefined;
  }
  return safeReturnPath(`${pathname}${searchStr}`) ?? undefined;
}
