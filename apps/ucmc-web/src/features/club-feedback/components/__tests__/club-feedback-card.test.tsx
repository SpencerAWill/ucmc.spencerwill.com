import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClubFeedbackCard } from "#/features/club-feedback/components/club-feedback-card";
import type { ClubFeedbackSummary } from "#/features/club-feedback/server/club-feedback-fns";

// The card's status-change mutation imports the server fn shell, which
// in turn dynamic-imports `*-actions.server.ts`. We never click the
// dropdown in these tests, but the module graph still needs the server
// fn export — stub it so the import resolves under jsdom.
vi.mock("#/features/club-feedback/server/club-feedback-fns", () => ({
  updateClubFeedbackStatusFn: vi.fn(),
}));

function renderCard(props: Parameters<typeof ClubFeedbackCard>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClubFeedbackCard {...props} />
    </QueryClientProvider>,
  );
}

// Helpers for the four wire-payload shapes the server can emit.
function baseRow(
  overrides: Partial<ClubFeedbackSummary> = {},
): ClubFeedbackSummary {
  return {
    id: "cfb_1",
    kind: "suggestion",
    title: "More beginner hikes",
    body: "Body content",
    status: "open",
    anonymous: false,
    createdBy: "user_alice",
    createdByPublicId: "alice123",
    authorDisplayName: "Alice",
    authorAvatarKey: null,
    createdAt: Temporal.Instant.from("2026-05-01T12:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-05-01T12:00:00Z"),
    ...overrides,
  };
}

// Wire shape after the server's anonymity redaction: every identity
// column is null even though `anonymous` stays true. The card must
// derive "show as anonymous" from this shape, not from `isOwn`.
function redactedRow(): ClubFeedbackSummary {
  return baseRow({
    anonymous: true,
    createdBy: null,
    createdByPublicId: null,
    authorDisplayName: null,
    authorAvatarKey: null,
  });
}

describe("ClubFeedbackCard anonymity rendering", () => {
  it("renders the submitter name on a non-anonymous row", () => {
    renderCard({
      entry: baseRow(),
      showSubmitter: true,
      canManage: true,
      isOwn: false,
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Anonymous")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden from officers")).not.toBeInTheDocument();
  });

  it("shows the 'Anonymous' badge and no name when the server redacted the row", () => {
    renderCard({
      entry: redactedRow(),
      showSubmitter: true,
      canManage: true,
      // Manager viewing a redacted row is by definition not the owner.
      // The server stripped `createdBy`, so the page's `entry.createdBy
      // === viewerId` check yields false → isOwn false.
      isOwn: false,
    });
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    // The "Hidden from officers" badge is reserved for owners viewing
    // their own anon row — must NOT leak into the manager view.
    expect(screen.queryByText("Hidden from officers")).not.toBeInTheDocument();
  });

  it("shows 'Hidden from officers' badge when an owner views their own anonymous row", () => {
    // For the owner's view, the server does NOT redact: anonymous=true
    // with the identity columns still populated. The card adds an
    // ownership-only badge so the submitter remembers the row is hidden
    // from officers on the triage side.
    renderCard({
      entry: baseRow({
        anonymous: true,
        // server kept these populated because viewer === owner
      }),
      // Owners view their submissions in the "my" list, which doesn't
      // surface a submitter avatar — but the badge logic shouldn't
      // depend on showSubmitter, so test both branches.
      showSubmitter: false,
      canManage: false,
      isOwn: true,
    });
    expect(screen.getByText("Hidden from officers")).toBeInTheDocument();
    // The "Anonymous" submitter badge requires the row to be wire-
    // redacted (authorDisplayName === null). Owner's view keeps the
    // name, so no submitter-row anon badge.
    expect(screen.queryByText(/^Anonymous$/)).not.toBeInTheDocument();
  });

  it("hides every submitter affordance when showSubmitter is false", () => {
    renderCard({
      entry: baseRow(),
      showSubmitter: false,
      canManage: false,
      isOwn: true,
    });
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Anonymous")).not.toBeInTheDocument();
  });
});
