/**
 * Read-only server functions for the Account page (current user's profile and
 * passkey list).
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "#/server/db";
import { loadCurrentPrincipal } from "#/server/auth/session";

export const getProfileFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const principal = await loadCurrentPrincipal();
    if (!principal) return { profile: null };

    const profile = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, principal.userId),
    });
    return { profile: profile ?? null };
  },
);

export const listPasskeysFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const principal = await loadCurrentPrincipal();
    if (!principal) return { passkeys: [] };

    const rows = await getDb().query.passkeyCredentials.findMany({
      where: eq(schema.passkeyCredentials.userId, principal.userId),
      columns: {
        id: true,
        nickname: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return { passkeys: rows };
  },
);

export const deletePasskeyFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const principal = await loadCurrentPrincipal();
    if (!principal) throw new Error("Not signed in");
    // Scope the delete to the current user — prevents IDOR.
    await getDb()
      .delete(schema.passkeyCredentials)
      .where(
        and(
          eq(schema.passkeyCredentials.id, data.id),
          eq(schema.passkeyCredentials.userId, principal.userId),
        ),
      );
    return { ok: true as const };
  });
