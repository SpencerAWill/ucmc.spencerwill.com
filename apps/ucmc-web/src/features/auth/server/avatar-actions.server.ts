/**
 * Avatar upload + remove actions. Called from the matching `*Fn` shells
 * in `#/server/auth/server-fns` via dynamic import so the R2/D1
 * dependencies don't leak onto the client module graph.
 *
 * Wire shape — accepts a `data:` URL string instead of FormData because
 * every existing server-fn validates JSON via zod. The 33% base64
 * overhead is negligible at our ~50 KB target and the client already
 * has a base64 string in hand from the canvas export.
 */
import { eq } from "drizzle-orm";

import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";
import {
  AVATAR_MAX_BYTES,
  avatarKey,
  deleteAvatar,
  putAvatar,
} from "#/server/r2/avatars.server";
import { decodeImageDataUrl } from "#/server/r2/image-data-url.server";
import { checkUploadRateLimit } from "#/server/rate-limit.server";

async function shortContentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadAvatarAction({
  dataUrl,
}: {
  dataUrl: string;
}): Promise<{ ok: true; avatarKey: string }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not authorized");
  }
  if (!(await checkUploadRateLimit(principal.userId))) {
    throw new Error("Too many avatar uploads, try again in a minute");
  }

  const { contentType, bytes } = decodeImageDataUrl(dataUrl, {
    allowed: ["image/webp", "image/jpeg", "image/png"],
    maxBytes: AVATAR_MAX_BYTES,
  });
  const hash = await shortContentHash(bytes);
  const key = avatarKey(principal.userId, hash, contentType);

  const db = getDb();
  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, principal.userId),
    columns: { avatarKey: true },
  });

  await putAvatar(key, bytes, contentType);

  await db
    .update(schema.profiles)
    .set({ avatarKey: key, updatedAt: Temporal.Now.instant() })
    .where(eq(schema.profiles.userId, principal.userId));

  if (existing?.avatarKey && existing.avatarKey !== key) {
    await deleteAvatar(existing.avatarKey);
  }

  return { ok: true, avatarKey: key };
}

export async function removeAvatarAction(): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not authorized");
  }

  const db = getDb();
  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, principal.userId),
    columns: { avatarKey: true },
  });

  if (existing?.avatarKey) {
    await db
      .update(schema.profiles)
      .set({ avatarKey: null, updatedAt: Temporal.Now.instant() })
      .where(eq(schema.profiles.userId, principal.userId));
    await deleteAvatar(existing.avatarKey);
  }

  return { ok: true };
}
