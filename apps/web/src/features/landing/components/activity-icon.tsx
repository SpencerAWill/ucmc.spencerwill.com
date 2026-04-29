/**
 * Resolves a curated icon name (stored as a string in landing_activities.icon)
 * to a lucide icon component. Whitelist of allowed names lives in
 * landing-schemas.ts (`ACTIVITY_ICONS`).
 */
import {
  Backpack,
  Compass,
  Footprints,
  Map,
  Mountain,
  MountainSnow,
  Snowflake,
  Sun,
  Tent,
  TentTree,
  Trees,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ActivityIcon as ActivityIconName } from "#/features/landing/server/landing-schemas";

const REGISTRY: Record<ActivityIconName, LucideIcon> = {
  Mountain,
  MountainSnow,
  Snowflake,
  TentTree,
  Backpack,
  Users,
  Compass,
  Map,
  Tent,
  Sun,
  Trees,
  Footprints,
};

export interface ActivityIconProps {
  name: ActivityIconName;
  className?: string;
}

export function ActivityIcon({ name, className }: ActivityIconProps) {
  const Icon = REGISTRY[name];
  return <Icon className={className} aria-hidden="true" />;
}
