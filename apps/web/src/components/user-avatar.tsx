import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";

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

export function avatarUrlFor(avatarKey: string): string {
  return `/api/avatars/${avatarKey}`;
}

export function initialsFor(value: string): string {
  const parts = value.split(/\s+|@/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase()
  );
}
