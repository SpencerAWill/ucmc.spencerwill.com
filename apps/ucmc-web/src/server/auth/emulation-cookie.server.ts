/**
 * Server-side read of the "View as" cookie.
 *
 * Read here — inside the session server fn — rather than from
 * `localStorage` on the client, because route guards run in
 * `beforeLoad`, which executes on the **server** for a hard navigation.
 * A client-only store would leave the guard blind on exactly the path
 * that matters: typing a URL for a page the previewed role can't see.
 *
 * Writes live on the client (`features/auth/api/view-mode.tsx`); the
 * cookie is not `httpOnly` for that reason. It carries no authority —
 * see `emulation.ts` for why forging it can only ever narrow.
 */
import { getCookie } from "@tanstack/react-start/server";

import { VIEW_AS_COOKIE_NAME } from "#/server/auth/emulation";

export function readViewAsCookie(): string | null {
  return getCookie(VIEW_AS_COOKIE_NAME) ?? null;
}
