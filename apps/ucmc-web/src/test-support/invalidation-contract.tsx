import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { UseMutationResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Harness for the cache-invalidation contract CLAUDE.md requires of
 * every `use-*.ts` mutation hook.
 *
 * The rule — "inline `useMutation` in routes/components is forbidden;
 * every mutation has a `use-*.ts` hook with a fixed cache-invalidation
 * contract" — had nothing enforcing the second half. A hook that
 * invalidates the wrong key, or quietly stops invalidating one, produces
 * a UI that shows stale data after a successful write: the officer
 * attests a waiver, the row stays in the queue, and they attest it
 * again. There is no error anywhere for that.
 *
 * Lives under `src/` so the `#/*` alias resolves it in both pools and in
 * `tsc`, for the same reason as `auth-stub.ts`. No app code imports it.
 */

/**
 * Render a mutation hook against a REAL `QueryClient`, run it, and
 * return every query key it invalidated.
 *
 * A real client rather than a mocked one: `invalidateQueries` is spied
 * on it, so the hook's own `useQueryClient()` resolves normally and the
 * test exercises the actual wiring instead of a stub that agrees with
 * whatever it is handed.
 */
export async function invalidatedKeysFor<TInput>(
  useHook: () => UseMutationResult<unknown, Error, TInput, unknown>,
  input: TInput,
): Promise<unknown[][]> {
  const queryClient = new QueryClient({
    defaultOptions: {
      // No retries: a mutation that rejects should surface immediately
      // rather than stall the test for three backoff rounds.
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useHook(), { wrapper });

  await result.current.mutateAsync(input);

  // `onSuccess` may await several invalidations; wait for the mutation
  // to settle before reading the spy, or a hook that invalidates after
  // an `await` reports zero keys and "passes" an emptiness check.
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
  });

  return invalidateSpy.mock.calls.map(
    (call) => (call[0]?.queryKey ?? []) as unknown[],
  );
}

/**
 * Assert a hook invalidated exactly the expected set of query keys.
 *
 * Compares as a SET: the contract is which caches are refreshed, not the
 * order `Promise.all` happened to resolve them in. Serialized so the
 * diff on failure names the key that is missing or extra rather than
 * printing two arrays of arrays.
 */
export async function expectInvalidates<TInput>(
  useHook: () => UseMutationResult<unknown, Error, TInput, unknown>,
  input: TInput,
  // `readonly (readonly unknown[])[]`, not `unknown[][]`: the query-key
  // constants are `as const`, so every one of them is a readonly tuple
  // and a mutable parameter type rejects all of them.
  expectedKeys: readonly (readonly unknown[])[],
): Promise<void> {
  const actual = await invalidatedKeysFor(useHook, input);

  const normalize = (keys: readonly (readonly unknown[])[]) =>
    keys.map((k) => JSON.stringify(k)).sort();

  expect(
    normalize(actual),
    "the hook's cache-invalidation contract changed",
  ).toEqual(normalize([...expectedKeys]));
}
