import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUploadAlbumOriginal } from "#/features/album/api/use-upload-album-original";

const uploadFn = vi.hoisted(() => vi.fn());
vi.mock("#/features/album/server/album-fns", () => ({
  uploadAlbumOriginalFn: uploadFn,
}));

const RESULT = {
  photoId: "p",
  originalKey: "o",
  fullKey: null,
  takenDate: null,
  originalBytes: 1,
  fullWidthPx: null,
  fullHeightPx: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function sentForm(input: { file: File; photoId?: string }) {
  const { result } = renderHook(() => useUploadAlbumOriginal(), { wrapper });
  await act(async () => {
    result.current.mutate(input);
  });
  await waitFor(() => {
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });
  return (uploadFn.mock.calls[0][0] as { data: FormData }).data;
}

beforeEach(() => {
  uploadFn.mockReset();
  uploadFn.mockResolvedValue(RESULT);
});

describe("useUploadAlbumOriginal", () => {
  it("sends the file and no photoId on create", async () => {
    const file = new File([new Uint8Array([1])], "a.jpg", {
      type: "image/jpeg",
    });
    const form = await sentForm({ file });

    expect((form.get("file") as File).name).toBe("a.jpg");
    expect(form.has("photoId")).toBe(false);
  });

  it("sends the photoId on edit", async () => {
    const file = new File([new Uint8Array([1])], "a.jpg", {
      type: "image/jpeg",
    });
    const form = await sentForm({ file, photoId: "abc" });

    expect(form.get("photoId")).toBe("abc");
  });
});
