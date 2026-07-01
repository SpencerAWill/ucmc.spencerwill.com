import { createFileRoute } from "@tanstack/react-router";

import {
  REGISTRATION_DISCLAIMER,
  SUBBRAND_DISAMBIGUATION,
} from "#/config/legal";

/**
 * The UC-mandated registration disclaimer (Rule 40-03-01) plus the
 * UCMC-vs-UC-Health disambiguation. Public; no auth required. The same
 * disclaimer text also lives in the sitewide footer — this route is
 * the canonical page that footer links point to so the text is always
 * one click away in its full, statutorily-required form.
 *
 * Rule 40-03-01 requires the disclaimer be rendered in Arial or Times
 * New Roman; the inline `style` survives Tailwind class purging.
 */
export const Route = createFileRoute("/disclaimer")({
  component: DisclaimerPage,
});

function DisclaimerPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Registration disclaimer
        </h1>
        <p className="text-sm text-muted-foreground">
          Required notice under University of Cincinnati Rule 40-03-01.
        </p>
      </header>
      <p
        className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed"
        style={{ fontFamily: 'Arial, "Helvetica Neue", sans-serif' }}
      >
        {REGISTRATION_DISCLAIMER}
      </p>
      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="text-base font-semibold">Disambiguation</h2>
        <p>{SUBBRAND_DISAMBIGUATION}</p>
      </section>
    </main>
  );
}
