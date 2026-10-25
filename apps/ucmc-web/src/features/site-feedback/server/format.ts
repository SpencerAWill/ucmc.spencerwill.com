/**
 * Compose the persisted feedback `body` from a structured submission.
 *
 * The DB schema keeps a single `body TEXT` column; structured bug /
 * feature inputs are flattened into a Markdown string here so D1 holds a
 * single human-readable record, which triage later quotes into GitHub
 * issue drafts. Section headings use `**Foo**` so they render
 * as bold on GitHub and as preserved-whitespace plain text in the
 * admin triage card (`whitespace-pre-wrap`).
 */
import type { SiteFeedbackInput } from "#/features/site-feedback/server/limits";

interface Section {
  heading: string;
  content: string | null | undefined;
}

function renderSections(sections: Section[]): string {
  return sections
    .map(({ heading, content }) => {
      const trimmed = content?.trim();
      if (!trimmed) {
        return null;
      }
      return `**${heading}**\n\n${trimmed}`;
    })
    .filter((s): s is string => s !== null)
    .join("\n\n");
}

export function composeSiteFeedbackBody(input: SiteFeedbackInput): string {
  if (input.kind === "general") {
    return input.body.trim();
  }
  if (input.kind === "bug") {
    return renderSections([
      { heading: "Describe the bug", content: input.bugDescription },
      { heading: "Steps to reproduce", content: input.stepsToReproduce },
      { heading: "Expected behavior", content: input.expectedBehavior },
      { heading: "Additional context", content: input.additionalContext },
      { heading: "Browser / user agent", content: input.userAgent },
    ]);
  }
  // feature
  return renderSections([
    {
      heading: "Is your feature request related to a problem?",
      content: input.problem,
    },
    {
      heading: "Describe the solution you'd like",
      content: input.proposedSolution,
    },
    {
      heading: "Describe alternatives you've considered",
      content: input.alternatives,
    },
    { heading: "Additional context", content: input.additionalContext },
  ]);
}
