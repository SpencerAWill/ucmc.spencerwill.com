/**
 * Resolves a curated icon name to its lucide component.
 *
 * Lives in `src/components/` rather than inside a feature because two
 * features' card editors pick from the same list — the home page's
 * activity cards (`features/landing`) and /volunteer's program cards
 * (`features/volunteer`) — and features can't import each other. It was
 * `features/landing/components/activity-icon.tsx` until the second
 * consumer arrived.
 *
 * The `Record<CuratedIconName, LucideIcon>` annotation is what pins this
 * map to `CURATED_ICONS`: adding a name to the list without adding its
 * component here is a type error rather than a runtime `undefined` that
 * renders as a blank square.
 */
import {
  Backpack,
  Compass,
  Footprints,
  Gift,
  Hammer,
  HandHeart,
  Handshake,
  HeartHandshake,
  Leaf,
  Map,
  Mountain,
  MountainSnow,
  Recycle,
  Route,
  Shovel,
  Snowflake,
  Sparkles,
  Sprout,
  Sun,
  Tent,
  TentTree,
  Trash2,
  TreeDeciduous,
  Trees,
  Users,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CuratedIconName } from "#/components/curated-icon/icon-names";

const REGISTRY: Record<CuratedIconName, LucideIcon> = {
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
  HandHeart,
  Handshake,
  Shovel,
  Hammer,
  Recycle,
  Trash2,
  Sprout,
  TreeDeciduous,
  Leaf,
  Waves,
  Route,
  Gift,
  HeartHandshake,
  Sparkles,
};

export interface CuratedIconProps {
  name: CuratedIconName;
  className?: string;
}

export function CuratedIcon({ name, className }: CuratedIconProps) {
  const Icon = REGISTRY[name];
  return <Icon className={className} aria-hidden="true" />;
}
