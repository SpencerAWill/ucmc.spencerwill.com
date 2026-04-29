import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { Button } from "#/components/ui/button";
import {
  WAIVER_LEGAL_BODY,
  WAIVER_PDF_PATH,
  WAIVER_VERSION,
} from "#/config/legal";

/**
 * Public reference copy of the UCMC paper waiver. The signed paper —
 * not anything on this page — is the legal artifact: members print
 * the canonical PDF, fill it out, sign it, and hand it to an officer
 * at a club meeting. The officer then attests in `/members/waivers`
 * that the paper is on file. The text below mirrors the binding legal
 * language from the PDF so screen-reader users can read what they're
 * agreeing to before printing. Form-blank fields (name, phone, address,
 * medical info, signature) are intentionally not surfaced here — those
 * are filled on paper and never stored on this site.
 */
export const Route = createFileRoute("/waiver")({
  component: WaiverPage,
});

function WaiverPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Waiver of liability
        </h1>
        <p className="text-sm text-muted-foreground">
          Reference copy of the canonical UCMC paper waiver (version{" "}
          <code>{WAIVER_VERSION}</code>).
        </p>
      </header>

      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-sm">
          To complete your waiver, download and print the PDF, fill in your
          information, sign it, and bring the signed copy to a club meeting. A
          club officer will mark you attested for the current academic cycle so
          you can participate in club activities.
        </p>
        <div className="mt-3">
          <Button asChild>
            <a href={WAIVER_PDF_PATH} download>
              Download blank waiver PDF
            </a>
          </Button>
        </div>
      </div>

      <LegalSections sections={WAIVER_LEGAL_BODY} />
    </main>
  );
}
