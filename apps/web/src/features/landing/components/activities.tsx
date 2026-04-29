import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";

import { landingContentQueryOptions } from "#/features/landing/api/queries";
import { ActivitiesEditor } from "#/features/landing/components/activities-editor";
import { ActivityIcon } from "#/features/landing/components/activity-icon";
import { EditAffordance } from "#/features/landing/components/edit-affordance";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import type { ActivitySummary } from "#/features/landing/server/landing-fns";

export function Activities() {
  const { data } = useQuery(landingContentQueryOptions());
  const items = data?.activities ?? [];

  return (
    <section className="relative border-b bg-muted/30 py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 space-y-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            What we do
          </h2>
          <p className="text-muted-foreground">
            Things you can plug into as a member.
          </p>
        </div>
        {items.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((activity) => (
              <ActivityCard key={activity.id} activity={activity} />
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            No activities listed yet.
          </p>
        )}
      </div>
      <EditAffordance label="Edit activities">
        {({ close }) => (
          <ActivitiesEditor items={items} onSaved={close} onCancel={close} />
        )}
      </EditAffordance>
    </section>
  );
}

/**
 * Activity card with optional image reveal.
 *
 * Default state: icon + title + blurb.
 * With image:
 *   - desktop hover → image fades in as a background, dark scrim brings
 *     the white text forward.
 *   - touch → tap toggles the same revealed state. Tapping a different
 *     card collapses this one (state is local, but only one card "wins"
 *     visually since the icon-on-hover scrim is opaque).
 *   - a small image-corner badge in the default state hints to touch
 *     users that there's something to reveal.
 *
 * Without image: card behaves exactly like the v1 design.
 */
function ActivityCard({ activity }: { activity: ActivitySummary }) {
  const [tapped, setTapped] = useState(false);
  const hasImage = Boolean(activity.imageKey);

  if (!hasImage) {
    return (
      <article className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <ActivityIcon name={activity.icon} className="size-8 text-primary" />
        <h3 className="mt-2 leading-none font-semibold">{activity.title}</h3>
        <p className="mt-3 text-sm text-muted-foreground">{activity.blurb}</p>
      </article>
    );
  }

  return (
    <article
      onClick={() => setTapped((t) => !t)}
      onMouseLeave={() => setTapped(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setTapped((t) => !t);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={tapped}
      aria-label={`${activity.title}: tap to ${tapped ? "hide" : "reveal"} photo`}
      className={
        // `group` enables the descendant `group-hover` selectors below.
        // `data-[active=true]` mirrors the hover state for touch (tap)
        // so styling stays in CSS instead of inline.
        "group relative h-full min-h-[220px] cursor-pointer overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:shadow-lg"
      }
      data-active={tapped ? "true" : "false"}
    >
      {/* Image layer — fades in on hover/tap, scales slightly for life. */}
      <img
        src={landingImageUrlFor(activity.imageKey!)}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full scale-105 object-cover opacity-0 transition-all duration-500 group-hover:opacity-100 group-data-[active=true]:opacity-100"
        loading="lazy"
      />
      {/* Dark scrim for legibility once image is visible. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-data-[active=true]:opacity-100"
      />

      {/* Default content — switches to white type when revealed. */}
      <div className="relative flex h-full flex-col gap-3 p-6">
        <ActivityIcon
          name={activity.icon}
          className="size-8 text-primary transition-colors duration-300 group-hover:text-white group-data-[active=true]:text-white"
        />
        <h3 className="leading-none font-semibold transition-colors duration-300 group-hover:text-white group-data-[active=true]:text-white">
          {activity.title}
        </h3>
        <p className="text-sm text-muted-foreground transition-colors duration-300 group-hover:text-white/90 group-data-[active=true]:text-white/90">
          {activity.blurb}
        </p>

        {/* Small affordance hint — tells touch users there's a photo. */}
        <div
          aria-hidden="true"
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm transition-opacity duration-300 group-hover:opacity-0 group-data-[active=true]:opacity-0"
        >
          <ImageIcon className="size-3.5" />
        </div>
      </div>
    </article>
  );
}
