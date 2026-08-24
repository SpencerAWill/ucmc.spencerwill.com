import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Officers } from "#/features/landing/components/officers";
import { LANDING_CONTENT_QUERY_KEY } from "#/features/landing/api/query-keys";
import type { LandingContent } from "#/features/landing/server/landing-actions.server";

// `Officers` reads the landing content bundle off the React Query cache. The
// component never calls the server fn in tests because we seed the cache
// before rendering — but the import graph still pulls in `landing-fns`, so
// stub the server fn module to keep the test pool boundary clean.
vi.mock("#/features/landing/server/landing-fns", () => ({
  getLandingContentFn: vi.fn(),
}));

function renderWithContent(content: Partial<LandingContent>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const fullContent: LandingContent = {
    settings: {},
    faqItems: [],
    activities: [],
    officers: [],
    ...content,
  };
  client.setQueryData(LANDING_CONTENT_QUERY_KEY, fullContent);
  return render(
    <QueryClientProvider client={client}>
      <Officers />
    </QueryClientProvider>,
  );
}

describe("Officers", () => {
  it("renders nothing when no officer roles are present", () => {
    const { container } = renderWithContent({ officers: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per (role, member) pair with name + role label", () => {
    renderWithContent({
      officers: [
        {
          roleId: "role_president",
          displayName: "President",
          position: 0,
          members: [
            {
              userId: "u_alice",
              preferredName: "Alice",
              avatarKey: null,
            },
            {
              userId: "u_bob",
              preferredName: "Bob",
              avatarKey: null,
            },
          ],
        },
        {
          roleId: "role_treasurer",
          displayName: "Treasurer",
          position: 1,
          members: [
            {
              userId: "u_carol",
              preferredName: "Carol",
              avatarKey: null,
            },
          ],
        },
      ],
    });

    expect(
      screen.getByRole("heading", { name: /meet the officers/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    // Two co-presidents → "President" label rendered twice.
    expect(screen.getAllByText("President")).toHaveLength(2);
    expect(screen.getByText("Treasurer")).toBeInTheDocument();
  });

  it("falls back to initials when avatar key is null", () => {
    renderWithContent({
      officers: [
        {
          roleId: "role_president",
          displayName: "President",
          position: 0,
          members: [
            {
              userId: "u_alice",
              preferredName: "Alice Mountaineer",
              avatarKey: null,
            },
          ],
        },
      ],
    });

    // Initials derive from preferredName via `initialsFor` in UserAvatar:
    // "Alice Mountaineer" → "AM"
    expect(screen.getByText("AM")).toBeInTheDocument();
  });
});
