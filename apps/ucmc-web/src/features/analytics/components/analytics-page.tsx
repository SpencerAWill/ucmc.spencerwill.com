/**
 * The frame every analytics surface renders inside: heading, the one
 * question the page answers, the sub-nav, and the body.
 *
 * Exists so the six routes carry no chrome of their own — they declare
 * their guard and hand this a title and children. `PageContainer`
 * stays the owner of the gutter and measure (`wide`: these pages are
 * panel grids, which is what that tier is for).
 */
import { PageContainer } from "#/components/layouts/page-container";
import { AnalyticsSubnav } from "#/features/analytics/components/analytics-subnav";

export function AnalyticsPage({
  title,
  question,
  controls,
  children,
}: {
  title: string;
  question: string;
  /** Season / period controls, rendered beside the heading. */
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PageContainer width="wide" className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{question}</p>
          </div>
          {controls}
        </div>
        <AnalyticsSubnav />
      </header>
      {children}
    </PageContainer>
  );
}
