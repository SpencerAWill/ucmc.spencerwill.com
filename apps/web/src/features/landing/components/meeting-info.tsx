import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, Mail, MapPin } from "lucide-react";

import { Card, CardContent } from "#/components/ui/card";
import { landingContentQueryOptions } from "#/features/landing/api/queries";
import { EditAffordance } from "#/features/landing/components/edit-affordance";
import { MeetingInfoEditor } from "#/features/landing/components/meeting-info-editor";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";

function readString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function MeetingInfo() {
  const { data } = useQuery(landingContentQueryOptions());
  const settings = data?.settings ?? {};
  const dayTime = readString(settings["meeting.day_time"]);
  const location = readString(settings["meeting.location"]);
  const email = readString(settings["meeting.email"]);
  const instagramUrl = readString(settings["meeting.instagram_url"]);
  const imageKey = readString(settings["meeting.image_key"]);
  const hasImage = imageKey.length > 0;

  return (
    <section
      className={
        // The whole section is `relative` so the absolute background
        // image at md+ can fill it. Background only renders when an
        // image is set.
        "relative overflow-hidden border-b py-16 md:py-20"
      }
    >
      {/* Desktop background — image absolute-fills behind the centered
          info card with a soft scrim for legibility. Hidden on mobile;
          mobile renders the image as a stacked block above the card. */}
      {hasImage ? (
        <>
          <img
            src={landingImageUrlFor(imageKey)}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 hidden size-full object-cover md:block"
            loading="lazy"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-gradient-to-b from-background/60 via-background/40 to-background/80 md:block"
          />
        </>
      ) : (
        <div className="absolute inset-0 -z-10 bg-muted/30" />
      )}

      {/* Mobile-only stacked image (md hides this — desktop uses the
          absolute background). */}
      {hasImage ? (
        <div className="relative mx-auto mb-8 max-w-2xl px-6 md:hidden">
          <div className="aspect-video overflow-hidden rounded-xl border shadow-sm">
            <img
              src={landingImageUrlFor(imageKey)}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      ) : null}

      <div className="relative mx-auto max-w-2xl px-6">
        <div className="mb-10 space-y-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Where to find us
          </h2>
          <p className="text-muted-foreground">
            Drop in to a meeting or send us a message.
          </p>
        </div>
        <Card className={hasImage ? "shadow-xl backdrop-blur" : undefined}>
          <CardContent className="space-y-4 pt-6">
            {dayTime ? (
              <Row icon={<CalendarDays />} label="Meetings" value={dayTime} />
            ) : null}
            {location ? (
              <Row icon={<MapPin />} label="Location" value={location} />
            ) : null}
            {email ? (
              <Row
                icon={<Mail />}
                label="Email"
                value={
                  <a href={`mailto:${email}`} className="hover:text-foreground">
                    {email}
                  </a>
                }
              />
            ) : null}
            {instagramUrl ? (
              <Row
                icon={<ExternalLink />}
                label="Instagram"
                value={
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground"
                  >
                    {instagramUrl.replace(/^https?:\/\//, "")}
                  </a>
                }
              />
            ) : null}
            {!dayTime && !location && !email && !instagramUrl ? (
              <p className="text-center text-sm text-muted-foreground">
                Meeting info not set yet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <EditAffordance label="Edit meeting info">
        {({ close }) => (
          <MeetingInfoEditor
            values={{ dayTime, location, email, instagramUrl }}
            imageKey={hasImage ? imageKey : null}
            onClose={close}
          />
        )}
      </EditAffordance>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 size-5 text-primary [&>svg]:size-5">{icon}</span>
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}
