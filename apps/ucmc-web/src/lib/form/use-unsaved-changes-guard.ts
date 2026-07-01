import type { AnyFormApi } from "@tanstack/react-form";
import { useBlocker } from "@tanstack/react-router";

export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave and discard them?";

/**
 * Prompt the user before leaving a form with unsaved changes.
 *
 * Reads `form.state.isDefaultValue` (the value-comparison flag, not
 * the interaction-sticky `isDirty`) and registers a TanStack Router
 * blocker plus a native `beforeunload` listener whenever the form
 * has diverged from its defaults.
 *
 * `skip` lets callers bypass the prompt for navigation that's part
 * of a successful save flow. **Pass a function** (`() => mutation.isSuccess`)
 * not a boolean — the prompt is evaluated inside `shouldBlockFn` at
 * the moment of navigation, and `mutation.mutate` resolves
 * synchronously enough that the navigate() call inside `onSuccess`
 * happens before React re-renders the component, so a captured
 * boolean closure is stale and the guard fires on the user's own
 * successful save. Reading `skip` as a function inside the callback
 * always sees the latest mutation state.
 *
 * Uses `window.confirm` for the prompt — minimal, browser-native, no
 * extra components. Can swap for a shadcn AlertDialog (with
 * `withResolver: true`) later if the UX needs upgrading.
 */
export function useUnsavedChangesGuard(
  form: AnyFormApi,
  opts?: { skip?: boolean | (() => boolean) },
): void {
  const shouldBlock = (): boolean => {
    if (form.state.isDefaultValue) {
      return false;
    }
    const skip =
      typeof opts?.skip === "function" ? opts.skip() : (opts?.skip ?? false);
    return !skip;
  };

  useBlocker({
    shouldBlockFn: () => {
      if (!shouldBlock()) {
        return false;
      }
      return !window.confirm(UNSAVED_CHANGES_MESSAGE);
    },
    enableBeforeUnload: () => shouldBlock(),
  });
}
