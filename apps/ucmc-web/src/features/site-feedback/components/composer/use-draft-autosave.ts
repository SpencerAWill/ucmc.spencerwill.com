import { useCallback, useEffect, useRef, useState } from "react";

import { useUpdateSiteFeedbackIssueDraft } from "#/features/site-feedback/api/use-update-site-feedback-issue-draft";

export const AUTOSAVE_DEBOUNCE_MS = 1000;

export type AutosaveStatus = "saved" | "saving" | "conflict" | "error";

export type ConflictReason = "conflict" | "not_draft";

/** What `flush()` found: saved, a failure to retry, or why saving stopped. */
export type FlushResult = "saved" | "error" | ConflictReason;

export interface DraftFields {
  title: string;
  summaryMd: string;
  labels: string[];
}

/**
 * Debounced autosave for the draft composer. A local hook over
 * `useUpdateSiteFeedbackIssueDraft`, which owns the cache contract; this one
 * only owns timing and the optimistic-concurrency token.
 *
 * `expectedUpdatedAtMs` is read once, at mount: after each successful save the
 * token comes from the server's reply, never from a refetched query, so a
 * background refetch can't hand the next save someone else's token. Saves are
 * serialised, so a slow save is never overtaken by a later one.
 *
 * A `conflict` or `not_draft` reply stops autosaving for good; the page has to
 * be reloaded. A blank title is not saved (the server requires one).
 */
export function useDraftAutosave(args: {
  issueId: string;
  expectedUpdatedAtMs: number;
}) {
  const { issueId } = args;
  const update = useUpdateSiteFeedbackIssueDraft();
  const updateRef = useRef(update.mutateAsync);
  updateRef.current = update.mutateAsync;

  const token = useRef(args.expectedUpdatedAtMs);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<DraftFields | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false);
  // Mirrors `conflictReason` for `flush()`, whose caller holds a closure
  // from before the save that set it.
  const stoppedReason = useRef<ConflictReason | null>(null);

  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [conflictReason, setConflictReason] = useState<ConflictReason | null>(
    null,
  );

  const run = useCallback(() => {
    timer.current = null;
    const fields = pending.current;
    if (fields === null || stopped.current) {
      return Promise.resolve();
    }
    pending.current = null;
    setStatus("saving");
    chain.current = chain.current.then(async () => {
      if (stopped.current) {
        return;
      }
      try {
        const result = await updateRef.current({
          id: issueId,
          ...fields,
          expectedUpdatedAtMs: token.current,
        });
        if (result.ok) {
          token.current = result.updatedAtMs;
          if (pending.current === null && timer.current === null) {
            setStatus("saved");
          }
        } else {
          stopped.current = true;
          stoppedReason.current = result.reason;
          setConflictReason(result.reason);
          setStatus("conflict");
        }
      } catch {
        // Network or validation failure: put the fields back so the next
        // schedule or flush retries them, and say so.
        pending.current ??= fields;
        setStatus("error");
      }
    });
    return chain.current;
  }, [issueId]);

  const schedule = useCallback(
    (fields: DraftFields) => {
      if (stopped.current || fields.title.trim() === "") {
        return;
      }
      pending.current = fields;
      setStatus("saving");
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        void run();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [run],
  );

  /**
   * Save now and wait for it; call before an action that reads the draft.
   * Resolves with the result: only `saved` means the server has it, and a
   * stopped autosave resolves with its reason.
   */
  const flush = useCallback(async (): Promise<FlushResult> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    await run();
    await chain.current;
    if (stopped.current) {
      return stoppedReason.current ?? "conflict";
    }
    return pending.current === null ? "saved" : "error";
  }, [run]);

  useEffect(
    () => () => {
      // Leaving the page with an edit still waiting, whether on the debounce
      // timer or restored after a failed save: send it now.
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      if (pending.current !== null) {
        void run();
      }
    },
    [run],
  );

  return { status, conflictReason, schedule, flush };
}
