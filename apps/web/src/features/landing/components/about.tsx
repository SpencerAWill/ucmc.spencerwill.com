import { useQuery } from "@tanstack/react-query";

import { landingContentQueryOptions } from "#/features/landing/api/queries";
import { AboutEditor } from "#/features/landing/components/about-editor";
import { EditAffordance } from "#/features/landing/components/edit-affordance";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";

const FALLBACK_PARAGRAPHS: string[] = [
  "The University of Cincinnati Mountaineering Club is a student-run organization for anyone curious about rock climbing, mountaineering, and the wider outdoors.",
];

export function About() {
  const { data } = useQuery(landingContentQueryOptions());
  const rawParas = data?.settings["about.paragraphs"];
  const paragraphs =
    Array.isArray(rawParas) &&
    rawParas.every((v): v is string => typeof v === "string")
      ? rawParas
      : FALLBACK_PARAGRAPHS;

  const rawImage = data?.settings["about.image_key"];
  const imageKey =
    typeof rawImage === "string" && rawImage.length > 0 ? rawImage : null;

  return (
    <section className="relative border-b py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight md:text-4xl">
          About the club
        </h2>
        {imageKey ? (
          <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-12">
            <div className="overflow-hidden rounded-xl border shadow-sm">
              <img
                src={landingImageUrlFor(imageKey)}
                alt=""
                className="aspect-4/3 size-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="space-y-5">
              {paragraphs.map((para, i) => (
                <p key={i} className="text-muted-foreground">
                  {para}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-prose space-y-5">
            {paragraphs.map((para, i) => (
              <p key={i} className="text-muted-foreground">
                {para}
              </p>
            ))}
          </div>
        )}
      </div>
      <EditAffordance label="Edit about section">
        {({ close }) => (
          <AboutEditor
            paragraphs={paragraphs}
            imageKey={imageKey}
            onClose={close}
          />
        )}
      </EditAffordance>
    </section>
  );
}
