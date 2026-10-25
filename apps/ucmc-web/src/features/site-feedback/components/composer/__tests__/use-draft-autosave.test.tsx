import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftAutosave } from "#/features/site-feedback/components/composer/use-draft-autosave";

const mutateAsync = vi.fn();
vi.mock(
  "#/features/site-feedback/api/use-update-site-feedback-issue-draft",
  () => ({ useUpdateSiteFeedbackIssueDraft: () => ({ mutateAsync }) }),
);

const draft = (title: string) => ({ title, summaryMd: "", labels: ["bug"] });

beforeEach(() => {
  vi.useFakeTimers();
  mutateAsync.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDraftAutosave", () => {
  it("debounces 1000ms and saves once with the latest value", async () => {
    mutateAsync.mockResolvedValue({ ok: true, updatedAtMs: 2000 });
    const { result } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    act(() => {
      result.current.schedule(draft("a"));
      result.current.schedule(draft("ab"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(mutateAsync).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "sfi_1",
      title: "ab",
      summaryMd: "",
      labels: ["bug"],
      expectedUpdatedAtMs: 1000,
    });
    expect(result.current.status).toBe("saved");
  });

  it("sends the token returned by the previous save next time", async () => {
    mutateAsync.mockResolvedValue({ ok: true, updatedAtMs: 2000 });
    const { result } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    for (const title of ["a", "b"]) {
      act(() => {
        result.current.schedule(draft(title));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "b", expectedUpdatedAtMs: 2000 }),
    );
  });

  it("enters conflict and stops autosaving", async () => {
    mutateAsync.mockResolvedValue({ ok: false, reason: "conflict" });
    const { result } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    act(() => {
      result.current.schedule(draft("a"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.status).toBe("conflict");
    expect(result.current.conflictReason).toBe("conflict");
    act(() => {
      result.current.schedule(draft("b"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("does not save a blank title", async () => {
    const { result } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    act(() => {
      result.current.schedule(draft("   "));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("restores the fields after a thrown save and flush reports the failure", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    act(() => {
      result.current.schedule(draft("a"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.status).toBe("error");
    mutateAsync.mockResolvedValue({ ok: true, updatedAtMs: 2000 });
    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe("saved");
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "a", expectedUpdatedAtMs: 1000 }),
    );
  });

  it("flush resolves with the conflict reason itself", async () => {
    mutateAsync.mockResolvedValue({ ok: false, reason: "not_draft" });
    const { result } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    act(() => {
      result.current.schedule(draft("a"));
    });
    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });
    // Read from the call, not from a re-render: the caller's closure holds
    // the reason from before the save.
    expect(flushed).toBe("not_draft");
  });

  it("sends fields restored after an error when unmounted", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("offline"));
    mutateAsync.mockResolvedValue({ ok: true, updatedAtMs: 2000 });
    const { result, unmount } = renderHook(() =>
      useDraftAutosave({ issueId: "sfi_1", expectedUpdatedAtMs: 1000 }),
    );
    act(() => {
      result.current.schedule(draft("a"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.status).toBe("error");
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "a" }),
    );
  });
});
