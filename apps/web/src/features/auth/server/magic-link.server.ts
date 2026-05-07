/**
 * Magic-link request + atomic consume. The token in the URL is 32 bytes of
 * random, base64url-encoded. Only a SHA-256 hash is stored in D1 — a
 * stolen DB snapshot can't replay outstanding links.
 *
 * Single-use is enforced by `UPDATE ... SET consumed_at = now() WHERE
 * token_hash = ? AND consumed_at IS NULL RETURNING ...`: atomic per-row in
 * SQLite/D1, so two concurrent verifies can't both succeed.
 *
 * This module deliberately does NOT open a session. `consumeMagicLink`
 * returns a {email, intent} proof; callers decide what to do with it
 * (land on registration, mint a session for an existing approved user,
 * etc.).
 */
import { and, eq, isNull } from "drizzle-orm";

import { normalizeEmail } from "#/server/auth/email-normalize";
import { getDb, schema } from "#/server/db";
import { magicLinkEmail, sendEmail } from "#/server/email/resend";

import { env } from "#/server/cloudflare-env";

export const MAGIC_LINK_TTL_MS = 1000 * 60 * 15; // 15 minutes

export interface MagicLinkProof {
  email: string;
  intent: schema.MagicLinkIntent;
  // Only populated for `intent = "add_email"`. The consume caller
  // asserts `session.userId === targetUserId` before attaching the
  // email to the user; cross-account or logged-out clicks are
  // refused.
  targetUserId: string | null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url(new Uint8Array(digest));
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Discriminated arg shape so the type system enforces "add_email
 * requires targetUserId" and "register/login don't carry one."
 * Without this split, an `add_email` caller that forgot the targetUserId
 * would silently insert a link whose consume can never satisfy the
 * cross-account guard.
 *
 * `redirect` is the optional post-sign-in destination round-tripped
 * through the email URL. Caller validates leading-"/"; server-fns.ts's
 * zod refinement is the canonical gatekeeper, and /auth/callback
 * re-validates before navigating.
 */
export type RequestMagicLinkArgs =
  | {
      intent: "register" | "login";
      email: string;
      redirect?: string;
    }
  | {
      intent: "add_email";
      email: string;
      targetUserId: string;
    };

/**
 * Issue a magic link and send it by email. Always resolves successfully
 * from the caller's perspective (even for unknown emails) to avoid
 * leaking which addresses are registered — timing jitter is added in the
 * Phase 10 hardening pass.
 *
 * For `intent = "add_email"`, the link URL points at `/verify-email`
 * instead of `/auth/callback`, and the consume handler asserts
 * `session.userId === targetUserId` before attaching.
 */
export async function requestMagicLink(
  args: RequestMagicLinkArgs,
): Promise<void> {
  const email = normalizeEmail(args.email);
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);

  await getDb()
    .insert(schema.magicLinks)
    .values({
      tokenHash,
      email,
      intent: args.intent,
      targetUserId: args.intent === "add_email" ? args.targetUserId : null,
      createdAt: now,
      expiresAt,
    });

  const params = new URLSearchParams({ token });
  if (
    args.intent !== "add_email" &&
    args.redirect &&
    args.redirect.startsWith("/")
  ) {
    params.set("redirect", args.redirect);
  }
  const callbackPath =
    args.intent === "add_email" ? "/verify-email" : "/auth/callback";
  const url = `${env.APP_BASE_URL}${callbackPath}?${params.toString()}`;
  await sendEmail(magicLinkEmail({ to: email, url, intent: args.intent }));
}

/**
 * Atomic single-use consume. Returns a proof only if the token is fresh,
 * unconsumed, and unexpired. Consumed tokens — even on the same request
 * that is about to fail the expiry check — stay marked consumed; this is
 * fine because the only way to get an expired-but-unconsumed row is a
 * clock anomaly, and we'd rather over-invalidate than double-spend.
 */
export async function consumeMagicLink(
  token: string,
): Promise<MagicLinkProof | null> {
  const tokenHash = await hashToken(token);
  const consumedAt = new Date();
  const updated = await getDb()
    .update(schema.magicLinks)
    .set({ consumedAt })
    .where(
      and(
        eq(schema.magicLinks.tokenHash, tokenHash),
        isNull(schema.magicLinks.consumedAt),
      ),
    )
    .returning();

  const row = updated.at(0);
  if (!row) {
    return null;
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return {
    email: row.email,
    intent: row.intent,
    targetUserId: row.targetUserId,
  };
}
