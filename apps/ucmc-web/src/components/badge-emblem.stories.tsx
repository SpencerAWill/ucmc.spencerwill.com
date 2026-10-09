/**
 * The badge emblem's design surface — and the place to look at new
 * artwork before it ships.
 *
 * Every badge's picture is a file under `public/badges/`; this
 * component only masks it to a shape and frames it. Drop a
 * replacement in at the same filename, reload, and the Catalog story
 * below shows it in both themes at the size members actually see.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";

import { BadgeEmblem } from "#/components/badge-emblem";
import {
  BADGES,
  BADGE_KEYS,
  BADGE_TIERS,
} from "#/server/member-profile/badge-registry";

const meta = {
  title: "Components/BadgeEmblem",
  component: BadgeEmblem,
  parameters: { layout: "centered" },
} satisfies Meta<typeof BadgeEmblem>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One badge, at the size the profile showcase renders it. */
export const Default: Story = {
  args: {
    art: "white-oak.svg",
    shape: "circle",
    label: "White Oak",
    className: "size-24",
  },
};

/**
 * The three shapes side by side. Shape carries the badge's kind, so a
 * grid is readable before any label is: round is a season, a shield
 * is service, a hex is something you went out and did.
 */
export const Shapes: Story = {
  args: { art: "white-oak.svg", shape: "circle" },
  render: () => (
    <div className="flex items-end gap-6">
      <BadgeEmblem art="white-oak.svg" shape="circle" className="size-20" />
      <BadgeEmblem art="pack-mule.svg" shape="hex" className="size-20" />
      <BadgeEmblem art="officer.svg" shape="shield" className="size-20" />
    </div>
  ),
};

/**
 * Tier frames. An untiered badge takes the brand green rather than
 * bronze — a bronze frame on a badge with no tiers would imply a
 * silver the member is missing.
 */
export const Tiers: Story = {
  args: { art: "pack-mule.svg", shape: "hex" },
  render: () => (
    <div className="flex items-end gap-6">
      <BadgeEmblem art="pack-mule.svg" shape="hex" className="size-20" />
      {BADGE_TIERS.map((tier) => (
        <BadgeEmblem
          key={tier}
          art="pack-mule.svg"
          shape="hex"
          tier={tier}
          className="size-20"
        />
      ))}
    </div>
  ),
};

/**
 * Earned beside unearned. A locked badge still shows its artwork,
 * drained and dashed, because the point of a locked badge is to be
 * wanted — hiding it entirely would make the catalog look complete
 * when it isn't.
 */
export const Locked: Story = {
  args: { art: "hemlock.svg", shape: "circle" },
  render: () => (
    <div className="flex items-end gap-6">
      <BadgeEmblem art="hemlock.svg" shape="circle" className="size-20" />
      <BadgeEmblem
        art="hemlock.svg"
        shape="circle"
        locked
        className="size-20"
      />
      <BadgeEmblem
        art="coming-soon.svg"
        shape="hex"
        locked
        className="size-20"
      />
    </div>
  ),
};

/** Every badge in the catalog, with the art each one currently uses. */
export const Catalog: Story = {
  args: { art: "redbud.svg", shape: "circle" },
  render: () => (
    <div className="grid max-w-3xl grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-5">
      {BADGE_KEYS.map((key) => {
        const badge = BADGES[key];
        return (
          <figure key={key} className="flex flex-col items-center gap-2">
            <BadgeEmblem
              art={badge.art}
              shape={badge.shape}
              locked={badge.blockedBy !== null}
              className="size-20"
            />
            <figcaption className="text-center text-xs font-medium">
              {badge.label}
            </figcaption>
          </figure>
        );
      })}
    </div>
  ),
};
