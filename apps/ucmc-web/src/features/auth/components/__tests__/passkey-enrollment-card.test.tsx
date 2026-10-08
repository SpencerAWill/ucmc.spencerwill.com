import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeyEnrollmentCard } from "#/features/auth/components/passkey-enrollment-card";

const flags = vi.hoisted(() => ({
  current: { pages: { my_security: true } },
}));

vi.mock("#/features/settings/api/queries", () => ({
  publicFlagsQueryOptions: () => ({
    queryKey: ["public-flags"],
    queryFn: () => flags.current,
    placeholderData: flags.current,
  }),
}));

vi.mock("#/features/auth/server/webauthn-fns", () => ({
  webauthnRegisterBeginFn: vi.fn(),
  webauthnRegisterFinishFn: vi.fn(),
}));

vi.mock("#/features/auth/server/server-fns", () => ({
  getSessionFn: vi.fn(),
  signOutFn: vi.fn(),
}));

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PasskeyEnrollmentCard />
    </QueryClientProvider>,
  );
}

describe("PasskeyEnrollmentCard", () => {
  beforeEach(() => {
    flags.current = { pages: { my_security: true } };
  });

  it("offers enrollment on the pending page", () => {
    renderCard();
    expect(screen.getByText(/set up faster sign-in/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /add a passkey/i }),
    ).toBeInTheDocument();
  });

  /**
   * `/register/pending` is not under `/my`, so the flag does not reach
   * it through `requirePageFlag` the way it reaches `/my/security`.
   * `pages.my_security` is nonetheless the site-wide switch for passkey
   * UI, and an exec turning it off would not expect this entry point to
   * keep working.
   */
  it("disappears when pages.my_security is switched off", () => {
    flags.current = { pages: { my_security: false } };
    renderCard();
    expect(
      screen.queryByText(/set up faster sign-in/i),
    ).not.toBeInTheDocument();
  });
});
