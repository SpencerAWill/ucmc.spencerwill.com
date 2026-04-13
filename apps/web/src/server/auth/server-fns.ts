/**
 * TanStack Start server functions for the auth flow.
 *
 * All functions are POST except `getSessionFn` which is GET (read-only and
 * called from the root loader on every navigation).
 */
import { createServerFn } from "@tanstack/react-start";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "#/server/db";
import { env } from "#/server/cloudflare-env";
import { magicLinkEmail, sendEmail } from "#/server/email/resend";
import {
  consumeMagicLink,
  consumeWebAuthnChallenge,
  putMagicLink,
  putWebAuthnChallenge,
} from "#/server/store";
import {
  closeSession,
  loadCurrentPrincipal,
  loadPrincipal,
  openSession,
} from "#/server/auth/session";
import type { SessionPrincipal } from "#/server/auth/session";
import {
  bytesToBase64Url,
  finishAuthentication,
  finishRegistration,
  startAuthentication,
  startRegistration,
} from "#/server/webauthn";

const emailSchema = z.email().trim().toLowerCase().max(254);

// ── magic link ─────────────────────────────────────────────────────────────

export const requestMagicLinkFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: emailSchema }))
  .handler(async ({ data }) => {
    const token = crypto.randomUUID().replace(/-/g, "");

    const existing = await getDb().query.users.findFirst({
      where: eq(schema.users.email, data.email),
      columns: { id: true },
    });

    await putMagicLink(token, {
      email: data.email,
      intent: existing ? "login" : "register",
      createdAt: Date.now(),
    });

    const url = `${env.APP_BASE_URL}/auth/callback?token=${token}`;
    await sendEmail(
      magicLinkEmail({
        to: data.email,
        url,
        intent: existing ? "login" : "register",
      }),
    );

    // No user enumeration: always return ok.
    return { ok: true as const };
  });

export const consumeMagicLinkFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().min(16).max(64) }))
  .handler(async ({ data }) => {
    try {
      const record = await consumeMagicLink(data.token);
      if (!record) return { ok: false as const, reason: "invalid" as const };

      // Race-safe find-or-create: ON CONFLICT DO NOTHING on the unique email
      // index, then re-read. If two concurrent magic links land for the same
      // new email, only one insert wins; both requests end up with the same
      // user row.
      const id = `user_${crypto.randomUUID()}`;
      await getDb()
        .insert(schema.users)
        .values({ id, email: record.email, status: "pending" })
        .onConflictDoNothing({ target: schema.users.email });
      const user = (await getDb().query.users.findFirst({
        where: eq(schema.users.email, record.email),
      }))!;

      await openSession(user.id);
      const principal = await loadPrincipal(user.id);
      return { ok: true as const, principal };
    } catch (err) {
      console.error("[consumeMagicLinkFn] failed:", err);
      throw err;
    }
  });

// ── session / sign-out ─────────────────────────────────────────────────────

export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ principal: SessionPrincipal | null }> => {
    const principal = await loadCurrentPrincipal();
    return { principal };
  },
);

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async () => {
    await closeSession();
    return { ok: true as const };
  },
);

// ── profile submission ─────────────────────────────────────────────────────

export const profileInputSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  preferredName: z.string().trim().min(1).max(60),
  mNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^M\d{8}$/, "Must be 'M' followed by 8 digits"),
  phone: z.string().trim().min(7).max(32),
  emergencyContactName: z.string().trim().min(1).max(120),
  emergencyContactPhone: z.string().trim().min(7).max(32),
  ucAffiliation: z.enum(schema.ucAffiliation),
});

export const submitProfileFn = createServerFn({ method: "POST" })
  .inputValidator(profileInputSchema)
  .handler(async ({ data }) => {
    const principal = await loadCurrentPrincipal();
    if (!principal) throw new Error("Not signed in");

    await getDb()
      .insert(schema.profiles)
      .values({ userId: principal.userId, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.profiles.userId,
        set: { ...data, updatedAt: new Date() },
      });

    // Submitting profile (re)affirms pending status; only an approver can
    // move to 'approved'. Don't downgrade an already-approved user.
    if (principal.status !== "approved") {
      await getDb()
        .update(schema.users)
        .set({ status: "pending" })
        .where(eq(schema.users.id, principal.userId));
    }

    return { ok: true as const };
  });

// ── passkey enrollment / authentication ────────────────────────────────────

export const passkeyRegistrationOptionsFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const principal = await loadCurrentPrincipal();
  if (!principal) throw new Error("Not signed in");

  const existing = await getDb().query.passkeyCredentials.findMany({
    where: eq(schema.passkeyCredentials.userId, principal.userId),
    columns: { credentialId: true, transports: true },
  });

  const options = await startRegistration({
    userId: principal.userId,
    userName: principal.email,
    excludeCredentials: existing.map((c) => ({
      credentialId: c.credentialId,
      transports: c.transports?.split(",") as
        | AuthenticatorTransportFuture[]
        | undefined,
    })),
  });

  // Ceremony id is derived from the user — only one in-flight registration
  // per user. New registration overwrites any pending one.
  const ceremonyId = `reg:${principal.userId}`;
  await putWebAuthnChallenge(ceremonyId, "reg", {
    challenge: options.challenge,
    userId: principal.userId,
  });

  return options;
});

export const verifyPasskeyRegistrationFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      // Trust @simplewebauthn's response shape; validate at runtime by attempting verification.
      response: z.unknown(),
      nickname: z.string().trim().max(60).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const principal = await loadCurrentPrincipal();
    if (!principal) throw new Error("Not signed in");

    // Atomic single-use: deletes the row and returns it in one statement.
    const stored = await consumeWebAuthnChallenge(`reg:${principal.userId}`);
    if (!stored) throw new Error("Challenge expired");

    const verification = await finishRegistration({
      response: data.response as any,
      expectedChallenge: stored.challenge,
    });

    if (!verification.verified) {
      throw new Error("Passkey registration failed verification");
    }

    const info = verification.registrationInfo;
    const credentialId = info.credential.id; // base64url string
    const publicKey = bytesToBase64Url(info.credential.publicKey);

    await getDb()
      .insert(schema.passkeyCredentials)
      .values({
        id: `passkey_${crypto.randomUUID()}`,
        userId: principal.userId,
        credentialId,
        publicKey,
        counter: info.credential.counter,
        transports: info.credential.transports?.join(",") ?? null,
        nickname: data.nickname ?? null,
      });

    return { ok: true as const };
  });

export const passkeyAuthenticationOptionsFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const options = await startAuthentication({});
  // Opaque ceremony id — server-controlled, returned to the client which
  // sends it back with the response. Avoids parsing client-controlled
  // clientDataJSON to look up server state.
  const ceremonyId = `auth:${crypto.randomUUID()}`;
  await putWebAuthnChallenge(ceremonyId, "auth", {
    challenge: options.challenge,
  });
  return { options, ceremonyId };
});

export const verifyPasskeyAuthenticationFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      response: z.unknown(),
      ceremonyId: z.string().min(1).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const response = data.response as any;
    const credentialId: string = response?.id;
    if (!credentialId) throw new Error("Missing credential id");

    const credential = await getDb().query.passkeyCredentials.findFirst({
      where: eq(schema.passkeyCredentials.credentialId, credentialId),
    });
    if (!credential) throw new Error("Unknown passkey");

    // Atomic single-use.
    const stored = await consumeWebAuthnChallenge(data.ceremonyId);
    if (!stored) throw new Error("Challenge expired");

    const verification = await finishAuthentication({
      response,
      expectedChallenge: stored.challenge,
      credential: {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports?.split(",") as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });

    if (!verification.verified) {
      throw new Error("Passkey authentication failed");
    }

    await getDb()
      .update(schema.passkeyCredentials)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(schema.passkeyCredentials.id, credential.id));

    await openSession(credential.userId);
    const principal = await loadPrincipal(credential.userId);
    return { ok: true as const, principal };
  });

// ── approval (no UI yet — callable for the future admin queue) ─────────────

async function requireApprover(): Promise<SessionPrincipal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) throw new Error("Not signed in");
  if (!principal.permissions.includes("registrations:approve")) {
    throw new Error("Forbidden");
  }
  return principal;
}

export const approveRegistrationFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const approver = await requireApprover();
    await getDb()
      .update(schema.users)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: approver.userId,
      })
      .where(eq(schema.users.id, data.userId));

    // Auto-grant the 'member' role on approval.
    await getDb()
      .insert(schema.userRoles)
      .values({ userId: data.userId, roleId: "role_member" })
      .onConflictDoNothing();

    return { ok: true as const };
  });

export const rejectRegistrationFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireApprover();
    await getDb()
      .update(schema.users)
      .set({ status: "rejected" })
      .where(eq(schema.users.id, data.userId));
    return { ok: true as const };
  });
