/**
 * One `useAuth()` stub for the jsdom tests that mock it.
 *
 * Four test files stub `#/features/auth/api/use-auth`, and each used to
 * hand-roll the return object with only the members the component under
 * test happened to read. That breaks every time the hook gains a
 * predicate: `hasAnyPermission` landed with role-preview support and two
 * of the four suites failed wholesale on
 * `TypeError: hasAnyPermission is not a function` — a stub defect that
 * says nothing about the component.
 *
 * Building the whole shape from one permission list fixes both halves of
 * that: a new consumer of an existing predicate needs no test edit, and
 * the predicates can't disagree with each other about what the viewer
 * holds, because they read the same array.
 *
 * This is a *stub*, not the real hook — it deliberately has no emulation
 * logic. Pass `emulatedRole` if a component renders it; the narrowing
 * itself is covered against the real implementation in
 * `src/server/auth/__tests__/emulation.test.ts` and
 * `src/features/auth/api/__tests__/use-auth.test.tsx`.
 *
 * Lives under `src/` rather than `test/` only so the existing `#/*` alias
 * resolves it in both vitest pools and in `tsc`; nothing in the app
 * imports it, so it never reaches a bundle.
 */
export interface AuthStubOptions {
  isApproved?: boolean;
  emulatedRole?: string | null;
  principal?: unknown;
}

export function authStub(
  permissions: readonly string[],
  { isApproved = true, emulatedRole = null, principal }: AuthStubOptions = {},
) {
  return {
    isApproved,
    emulatedRole,
    principal: principal ?? null,
    hasPermission: (name: string) => permissions.includes(name),
    hasAnyPermission: (names: readonly string[]) =>
      names.some((name) => permissions.includes(name)),
  };
}
