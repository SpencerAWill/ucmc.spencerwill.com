import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { env } from "#/config/env";

export interface UserAvatarProps {
  avatarKey: string | null | undefined;
  /**
   * Used to derive initials and the alt text. Pass whatever is most
   * identifying for the user — usually `preferredName ?? fullName ??
   * email`.
   */
  name: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
  /** Override for the fallback node when no avatar is set. Defaults to initials. */
  fallback?: ReactNode;
}

export function UserAvatar({
  avatarKey,
  name,
  className,
  fallbackClassName,
  fallback,
}: UserAvatarProps) {
  const display = name?.trim() ?? "";
  return (
    <Avatar className={className}>
      {avatarKey ? (
        <AvatarImage
          src={avatarUrlFor(avatarKey)}
          alt={display ? `${display}'s avatar` : ""}
        />
      ) : null}
      <AvatarFallback className={fallbackClassName}>
        {fallback ?? initialsFor(display)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Build a browser-facing URL for an R2-stored avatar.
 *
 * With `VITE_R2_PUBLIC_HOST` set (deployed envs), emits
 * `https://${cdnHost}/avatars/<userId>/<hash>.<ext>` so bytes come
 * straight from the R2 custom domain, bypassing the worker.
 *
 * Without it (local dev / Miniflare), falls back to the worker-mediated
 * `/api/avatars/<key>` route. The two shapes resolve to the same R2
 * object.
 *
 * `avatarKey` is the full storage key (e.g. `avatars/<userId>/<hash>.webp`),
 * built by `avatarKey()` in `apps/ucmc-web/src/server/r2/avatars.server.ts`,
 * and always starts with `avatars/`.
 */
export function avatarUrlFor(avatarKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${avatarKey}`;
  }
  return `/api/avatars/${avatarKey}`;
}

export function initialsFor(value: string): string {
  const parts = value.split(/\s+|@/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase()
  );
}
