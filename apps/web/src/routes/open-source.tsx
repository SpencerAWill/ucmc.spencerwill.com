import { createFileRoute } from "@tanstack/react-router";

import { LegalSections } from "#/components/legal/legal-section";
import { Button } from "#/components/ui/button";
import type { LegalSection } from "#/config/legal";
import {
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  MAINTAINER_EMAIL,
  MAINTAINER_NAME,
} from "#/config/site";

/**
 * Public "how this site is built, maintained, and licensed" page —
 * the colophon, reachable at `/open-source` so the URL matches the
 * footer link text. Surfaces three things visitors and contributors
 * keep asking about: source code + license, the tech stack as a
 * narrative (not a dep dump), and how to report issues. Plus the
 * affiliation reality that the site is operated on a personal
 * Cloudflare account, which the registration disclaimer already says
 * in legalese — here we say it plainly.
 */
export const Route = createFileRoute("/open-source")({
  component: OpenSourcePage,
});

const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Built with",
    paragraphs: [
      "The site is a server-rendered React app built on TanStack Start (router, server functions, file-based routing) with Tailwind CSS v4 + shadcn/ui for the UI layer. Forms use TanStack Form; data tables use TanStack Table; data fetching is TanStack Query.",
      "It runs on Cloudflare Workers. Member data lives in Cloudflare D1 (a managed SQLite). Avatars live in Cloudflare R2. Short-lived auth state (magic-link challenges, WebAuthn ceremonies) lives in Cloudflare KV. Drizzle ORM is the schema + query layer.",
      "Authentication is passwordless: a magic-link email (sent via Resend) or a WebAuthn passkey. Cloudflare Turnstile sits in front of the magic-link request to deter bots.",
    ],
  },
  {
    heading: "Who maintains it",
    paragraphs: [
      `The site is built and maintained by ${MAINTAINER_NAME}, a UCMC alum, on a personal Cloudflare account on the spencerwill.com domain. UCMC is a Registered Student Organization at the University of Cincinnati; this site is operated independently of UC IT.`,
      "Per Bylaw 1.3 of the UCMC Constitution, the canonical club roster (including any sensitive data) is maintained by the Treasurer on UC's official CampusLINK platform. This site is an additive operational tool — never a replacement for the official roster.",
    ],
  },
  {
    heading: "Reporting issues",
    paragraphs: [
      "Found a bug, see something broken, or want to suggest a feature? Open an issue on the GitHub repository. For sensitive reports (security vulnerabilities, content concerns), email the maintainer directly.",
    ],
    references: [
      { label: "Source code on GitHub", href: GITHUB_REPO_URL },
      { label: "File an issue", href: GITHUB_ISSUES_URL },
      { label: `Email ${MAINTAINER_NAME}`, href: `mailto:${MAINTAINER_EMAIL}` },
    ],
  },
  {
    heading: "Third-party software & assets",
    paragraphs: [
      "The site builds on a stack of open-source projects (TanStack, React, Drizzle, Tailwind, shadcn/ui, Radix UI, Lucide, Zod, and many transitive dependencies — see package.json in the repository for the full set). Each is governed by its own license, retained in node_modules.",
      "The Instagram, Facebook, YouTube, and GitHub mark glyphs in the footer were drawn from each platform's official brand guidelines and are used solely to identify links to those services. Lucide React icons are used under the ISC license.",
    ],
  },
  {
    heading: "Privacy & data",
    paragraphs: [
      "The site stores only what's needed to run the member portal: email, preferred name, full legal name, phone, emergency contacts, and self-uploaded avatars. We do not collect UC-issued IDs, medical info, or signed waivers digitally — those belong to the Treasurer off-platform per Bylaw 1.3.",
    ],
  },
];

function OpenSourcePage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Open source</h1>
        <p className="text-sm text-muted-foreground">
          How this site is built, maintained, and licensed.
        </p>
      </header>

      <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
        <p className="text-sm">
          This site is{" "}
          <strong className="font-semibold">
            open source under the MIT license
          </strong>
          . The full source — including this page — is on GitHub. Pull requests,
          bug reports, and forks are welcome.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              View source on GitHub
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an issue
            </a>
          </Button>
        </div>
      </div>

      <LegalSections sections={SECTIONS} />
    </main>
  );
}
