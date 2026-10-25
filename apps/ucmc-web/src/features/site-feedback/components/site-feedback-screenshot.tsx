import { siteFeedbackScreenshotUrl } from "#/features/site-feedback/server/limits";
import type { SiteFeedbackScreenshotState } from "#/features/site-feedback/server/limits";

/**
 * A report's screenshot as a small thumbnail that opens the full image in
 * a new tab, or the note left once retention deleted it. The image is
 * served by a route that checks the viewer is the submitter or a site
 * maintainer, so the URL is useless to anyone else.
 */
export function SiteFeedbackScreenshot({
  feedbackId,
  state,
}: {
  feedbackId: string;
  state: SiteFeedbackScreenshotState;
}) {
  if (state === null) {
    return null;
  }
  if (state === "purged") {
    return (
      <p className="text-xs text-muted-foreground">
        Screenshot deleted 30 days after resolution.
      </p>
    );
  }
  const url = siteFeedbackScreenshotUrl(feedbackId);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-fit overflow-hidden rounded-md border hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <img
        src={url}
        alt="Screenshot of the page, opens full size"
        loading="lazy"
        className="h-24 w-auto max-w-full object-cover object-top"
      />
    </a>
  );
}
