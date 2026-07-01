import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { ABOUT_BODY } from "#/config/legal";

/**
 * Public "about UCMC" page. Frames the club, the open-membership
 * Article III §3.2 invariant, and the additive-not-canonical
 * relationship to CampusLINK. The colophon-style "/open-source" page
 * is a sibling that covers the *site* rather than the *club*.
 */
export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">About UCMC</h1>
        <p className="text-sm text-muted-foreground">
          Who we are, how we operate, and how this site fits in.
        </p>
      </header>
      <LegalSections sections={ABOUT_BODY} />
    </main>
  );
}
