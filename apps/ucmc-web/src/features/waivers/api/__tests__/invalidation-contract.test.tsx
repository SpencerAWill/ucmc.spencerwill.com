import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MY_WAIVER_HISTORY_QUERY_KEY,
  MY_WAIVER_STATUS_QUERY_KEY,
  WAIVER_PENDING_QUEUE_QUERY_KEY,
  waiverHistoryForUserQueryKey,
} from "#/features/waivers/api/query-keys";
import {
  useAttestWaiver,
  useBulkAttestWaivers,
  useRevokeWaiverAttestation,
} from "#/features/waivers/api/use-attest-waiver";
import { expectInvalidates } from "#/test-support/invalidation-contract";

/**
 * The cache-invalidation contract for the waivers mutation hooks.
 *
 * CLAUDE.md requires every mutation to live in a `use-*.ts` hook "with a
 * fixed cache-invalidation contract", and until now nothing enforced the
 * second half of that sentence. The failure it describes is silent: a
 * hook that drops a key leaves the officer looking at a queue that still
 * lists the member they just attested, so they attest them again. No
 * error is raised anywhere, and the server did its job correctly.
 *
 * Table-driven on purpose — this is the pattern for the other features.
 * Adding a hook means adding a row, and the row *is* the contract: if
 * you change which caches a mutation refreshes, you have to come here
 * and say so.
 *
 * The server fns are mocked because the subject is the client cache, not
 * the write. The `QueryClient` is real (see the harness) so the hook's
 * own `useQueryClient()` resolves through normal wiring.
 */
vi.mock("#/features/waivers/server/waiver-fns", () => ({
  attestWaiverFn: vi.fn(async () => ({ ok: true })),
  bulkAttestWaiversFn: vi.fn(async () => ({ ok: true, attested: 2 })),
  revokeWaiverAttestationFn: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const MEMBER_CACHES = [
  MY_WAIVER_STATUS_QUERY_KEY,
  MY_WAIVER_HISTORY_QUERY_KEY,
] as const;

describe("waivers mutation hooks invalidate exactly their documented caches", () => {
  it("useAttestWaiver refreshes the queue, the target's history, and the member's own view", async () => {
    await expectInvalidates(useAttestWaiver, { userId: "usr_target" }, [
      WAIVER_PENDING_QUEUE_QUERY_KEY,
      waiverHistoryForUserQueryKey("usr_target"),
      ...MEMBER_CACHES,
    ]);
  });

  it("useBulkAttestWaivers invalidates one history cache per target, and no others", async () => {
    // The interesting one. A bulk mutation that invalidated a single
    // broad `["members", "waivers", "history"]` prefix would also pass a
    // looser assertion while refetching every member's history; one that
    // forgot to map over `userIds` would leave all but the first target
    // stale. Both are pinned by naming each per-target key.
    await expectInvalidates(
      useBulkAttestWaivers,
      { userIds: ["usr_a", "usr_b", "usr_c"] },
      [
        WAIVER_PENDING_QUEUE_QUERY_KEY,
        waiverHistoryForUserQueryKey("usr_a"),
        waiverHistoryForUserQueryKey("usr_b"),
        waiverHistoryForUserQueryKey("usr_c"),
        ...MEMBER_CACHES,
      ],
    );
  });

  it("useRevokeWaiverAttestation scopes the history refresh by the caller-supplied userId", async () => {
    // `userId` is passed purely to scope invalidation — the server looks
    // the attestation up by `attestationId`. That makes it the kind of
    // argument a refactor drops as "unused", which would silently leave
    // the revoked member's history cached.
    await expectInvalidates(
      useRevokeWaiverAttestation,
      {
        attestationId: "att_1",
        reason: "signed in error",
        userId: "usr_target",
      },
      [
        WAIVER_PENDING_QUEUE_QUERY_KEY,
        waiverHistoryForUserQueryKey("usr_target"),
        ...MEMBER_CACHES,
      ],
    );
  });

  it("fails loudly if a hook stops invalidating anything", async () => {
    // Guards the harness itself: an `expectInvalidates` that silently
    // read zero calls would make every test above pass against a hook
    // with no `onSuccess` at all.
    await expect(
      expectInvalidates(useAttestWaiver, { userId: "usr_target" }, []),
    ).rejects.toThrow();
  });
});
