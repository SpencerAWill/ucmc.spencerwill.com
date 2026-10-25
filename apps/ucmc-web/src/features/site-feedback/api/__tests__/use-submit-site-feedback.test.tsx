import { describe, it, vi } from "vitest";

import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import { useSubmitSiteFeedback } from "#/features/site-feedback/api/use-submit-site-feedback";
import { expectInvalidates } from "#/test-support/invalidation-contract";

vi.mock("#/features/site-feedback/server/site-feedback-fns", () => ({
  submitSiteFeedbackFn: vi.fn(async () => ({ id: "sfb_1" })),
}));

describe("useSubmitSiteFeedback", () => {
  it("refreshes the submitter's list and the overview counts", async () => {
    await expectInvalidates(
      useSubmitSiteFeedback,
      { kind: "general", title: "T", body: "B" },
      [siteFeedbackKeys.mine, siteFeedbackKeys.overview],
    );
  });
});
