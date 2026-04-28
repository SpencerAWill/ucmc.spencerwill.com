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

import { loadCurrentPrincipal } from "#/features/auth/server/session.server";
import { getDb, schema } from "#/server/db";
import {
  AVATAR_MAX_BYTES,
  avatarKey,
  deleteAvatar,
  putAvatar,
} from "#/server/r2/avatars.server";
import type { AvatarContentType } from "#/server/r2/avatars.server";
import { checkUploadRateLimit } from "#/server/rate-limit.server";

const DATA_URL_RE =
  /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+=*)$/;

function decodeDataUrl(dataUrl: string): {
  contentType: AvatarContentType;
  bytes: ArrayBuffer;
} {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("Avatar data URL is not a recognized image type");
  }
  const contentType = match[1] as AvatarContentType;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new Error(
      `Avatar exceeds ${AVATAR_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  // Magic-byte check: an attacker who skips the client could lie in
  // the Content-Type prefix, so verify the actual bytes match.
  if (!matchesMagic(bytes, contentType)) {
    throw new Error("Avatar bytes do not match declared content type");
  }
  return { contentType, bytes: bytes.buffer };
}

function matchesMagic(bytes: Uint8Array, contentType: AvatarContentType) {
  if (contentType === "image/webp") {
    // RIFF....WEBP
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  if (contentType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

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

  const { contentType, bytes } = decodeDataUrl(dataUrl);
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
    .set({ avatarKey: key, updatedAt: new Date() })
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
      .set({ avatarKey: null, updatedAt: new Date() })
      .where(eq(schema.profiles.userId, principal.userId));
    await deleteAvatar(existing.avatarKey);
  }

  return { ok: true };
}
