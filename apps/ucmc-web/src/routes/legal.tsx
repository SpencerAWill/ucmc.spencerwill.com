import { Link, createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { LEGAL_INDEX_LINKS } from "#/config/legal";

/**
 * Public index of every legal/policy page on the site. Useful as a
 * single landing pad ("what's the official line on X?") rather than
 * making a visitor scan the footer link bar.
 */
export const Route = createFileRoute("/legal")({
  component: LegalIndexPage,
});

function LegalIndexPage() {
  return (
    <PageContainer width="prose" className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Legal</h1>
        <p className="text-sm text-muted-foreground">
          Every disclosure, policy, and reference document this site publishes,
          in one place.
        </p>
      </header>

      <ul className="space-y-4">
        {LEGAL_INDEX_LINKS.map((entry) => (
          <li
            key={entry.href}
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <Link to={entry.href} className="block space-y-1 no-underline">
              <span className="block text-base font-medium text-foreground underline underline-offset-2">
                {entry.label}
              </span>
              <span className="block text-sm text-muted-foreground">
                {entry.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
