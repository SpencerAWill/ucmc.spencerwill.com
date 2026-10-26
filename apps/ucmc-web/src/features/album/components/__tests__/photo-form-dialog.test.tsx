import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PhotoFormDialog } from "#/features/album/components/photo-form-dialog";
import {
  UPLOAD_GENERIC_FAILURE,
  UPLOAD_PHOTO_GONE,
} from "#/features/album/lib/upload-messages";
import type * as ImageUploadNs from "#/lib/image-upload";
import type {
  AlbumPhotoSummary,
  UploadAlbumOriginalResult,
} from "#/features/album/server/album-fns";

type ImageUploadModule = typeof ImageUploadNs;

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("#/features/album/api/use-album-mutations", () => ({
  useCreateAlbumPhoto: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateAlbumPhoto: () => ({ mutateAsync: mocks.update, isPending: false }),
}));

vi.mock("#/features/album/api/use-upload-album-original", () => ({
  useUploadAlbumOriginal: () => ({ mutateAsync: mocks.upload }),
}));

// jsdom has no canvas, so the real normalizer can't decode anything.
// The size/type gate is covered by image-upload's own tests.
vi.mock("#/lib/image-upload", async (importOriginal) => ({
  ...(await importOriginal<ImageUploadModule>()),
  normalizeImageFile: (file: File) => Promise.resolve(file),
  encodeCanvasToDataUrl: () => Promise.resolve("data:image/webp;base64,AAAA"),
}));

// The real cropper needs layout jsdom doesn't have. This stand-in
// completes a crop on click, which is all submit() asks of it.
vi.mock("react-image-crop", () => ({
  default: ({
    children,
    onComplete,
  }: {
    children: React.ReactNode;
    onComplete: (p: object) => void;
  }) => (
    <div>
      {children}
      <button
        type="button"
        onClick={() =>
          onComplete({ x: 0, y: 0, width: 10, height: 10, unit: "px" })
        }
      >
        complete crop
      </button>
    </div>
  ),
  centerCrop: (c: unknown) => c,
  makeAspectCrop: (c: unknown) => c,
}));

vi.mock("#/config/env", () => ({ env: { VITE_R2_PUBLIC_HOST: undefined } }));

function photo(overrides: Partial<AlbumPhotoSummary> = {}): AlbumPhotoSummary {
  return {
    id: "alb_1",
    publicId: "abc123",
    caption: "Sunset from the summit",
    credit: "A. Climber",
    takenAt: Temporal.Instant.from("2026-07-04T18:00:00Z"),
    tag: "trail-day",
    altText: "A climber silhouetted against an orange sky",
    imageKey: "gallery/alb_1/a1b2c3d4e5f60718.webp",
    imageBytes: 120_000,
    widthPx: 1600,
    heightPx: 1200,
    fullHash: null,
    originalBytes: null,
    fullWidthPx: null,
    fullHeightPx: null,
    ...overrides,
  };
}

function uploaded(
  overrides: Partial<UploadAlbumOriginalResult> = {},
): UploadAlbumOriginalResult {
  return {
    photoId: "pid-1",
    originalKey: "album-originals/pid-1/aaaaaaaaaaaaaaaa.jpg",
    fullKey: "album-full/pid-1/aaaaaaaaaaaaaaaa.webp",
    takenDate: null,
    originalBytes: 1000,
    fullWidthPx: 4000,
    fullHeightPx: 3000,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pickFile(name: string) {
  const file = new File(["x"], name, { type: "image/jpeg" });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("no file input");
  }
  return { file, input };
}

describe("PhotoFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  /**
   * `photo-form-dialog` used to stash `crop.reset` in a ref, because
   * `useImageCrop` handed back a fresh function on every render and
   * depending on it directly would loop the seed effect. The hook now
   * guarantees a stable identity, the ref is gone, and the effect
   * depends on `resetCrop` like any ordinary value.
   *
   * These mount the dialog in every seed state. A regression — a
   * `useCallback` dropped from the hook, or its dep array widened back
   * to the caller-supplied `options` object — reappears here as React
   * #185, "Maximum update depth exceeded", which surfaces as a throw
   * rather than an assertion failure.
   */
  it("opens for a new photo without looping", () => {
    expect(() =>
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByText("Add photo")).toBeInTheDocument();
  });

  it("opens for an existing photo without looping", () => {
    expect(() =>
      render(
        <PhotoFormDialog
          seed={{ mode: "edit", photo: photo() }}
          onClose={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(
      screen.getByDisplayValue("Sunset from the summit"),
    ).toBeInTheDocument();
  });

  it("closes without looping, which is the path that calls resetCrop", () => {
    // `seed === null` is the only branch that invokes the crop reset, so
    // it's the one that would loop if `reset` churned identity.
    const { rerender } = render(
      <PhotoFormDialog
        seed={{ mode: "edit", photo: photo() }}
        onClose={vi.fn()}
      />,
    );
    expect(() =>
      rerender(<PhotoFormDialog seed={null} onClose={vi.fn()} />),
    ).not.toThrow();
  });

  describe("original line", () => {
    const MB = 1024 * 1024;

    it("shows the dimensions and size for a photo with an original", () => {
      render(
        <PhotoFormDialog
          seed={{
            mode: "edit",
            photo: photo({
              fullHash: "aaaaaaaaaaaaaaaa",
              originalBytes: 3.1 * MB,
              fullWidthPx: 3024,
              fullHeightPx: 4032,
            }),
          }}
          onClose={vi.fn()}
        />,
      );
      expect(
        screen.getByText("Original: 3024 \u00d7 4032 \u00b7 3.1 MB"),
      ).toBeInTheDocument();
    });

    it("shows only the size while the dimensions are missing", () => {
      render(
        <PhotoFormDialog
          seed={{
            mode: "edit",
            photo: photo({
              fullHash: "aaaaaaaaaaaaaaaa",
              originalBytes: 3.1 * MB,
            }),
          }}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText("Original: 3.1 MB")).toBeInTheDocument();
    });

    it("says no original is stored for a legacy photo", () => {
      render(
        <PhotoFormDialog
          seed={{ mode: "edit", photo: photo() }}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText("No original stored")).toBeInTheDocument();
    });

    it("shows nothing on create before an upload", () => {
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      expect(screen.queryByText(/Original:/)).not.toBeInTheDocument();
      expect(screen.queryByText("No original stored")).not.toBeInTheDocument();
    });

    it("shows the line from a fresh upload, ahead of the seed's", async () => {
      mocks.upload.mockResolvedValue(
        uploaded({
          originalBytes: 2 * MB,
          fullWidthPx: 4000,
          fullHeightPx: 3000,
        }),
      );
      render(
        <PhotoFormDialog
          seed={{
            mode: "edit",
            photo: photo({
              fullHash: "aaaaaaaaaaaaaaaa",
              originalBytes: 3.1 * MB,
              fullWidthPx: 3024,
              fullHeightPx: 4032,
            }),
          }}
          onClose={vi.fn()}
        />,
      );
      const user = userEvent.setup();
      const { file, input } = pickFile("new.jpg");
      await user.upload(input, file);
      expect(
        await screen.findByText("Original: 4000 \u00d7 3000 \u00b7 2.0 MB"),
      ).toBeInTheDocument();
    });

    const seeded = () => (
      <PhotoFormDialog
        seed={{
          mode: "edit",
          photo: photo({
            fullHash: "aaaaaaaaaaaaaaaa",
            originalBytes: 3.1 * MB,
            fullWidthPx: 3024,
            fullHeightPx: 4032,
          }),
        }}
        onClose={vi.fn()}
      />
    );
    const SEED_LINE = "Original: 3024 \u00d7 4032 \u00b7 3.1 MB";

    it("shows no line while a new pick uploads", async () => {
      mocks.upload.mockReturnValue(new Promise(() => undefined));
      render(seeded());
      const user = userEvent.setup();
      const { file, input } = pickFile("new.jpg");
      await user.upload(input, file);
      await screen.findByText("Uploading original…");
      expect(screen.queryByText(SEED_LINE)).not.toBeInTheDocument();
      expect(screen.queryByText("No original stored")).not.toBeInTheDocument();
    });

    it("shows no line after a failed upload", async () => {
      mocks.upload.mockRejectedValue(new Error("boom"));
      render(seeded());
      const user = userEvent.setup();
      const { file, input } = pickFile("new.jpg");
      await user.upload(input, file);
      await screen.findByRole("button", { name: "Try again" });
      expect(screen.queryByText(SEED_LINE)).not.toBeInTheDocument();
    });

    it("brings the seed's line back after Cancel new photo", async () => {
      mocks.upload.mockReturnValue(new Promise(() => undefined));
      render(seeded());
      const user = userEvent.setup();
      const { file, input } = pickFile("new.jpg");
      await user.upload(input, file);
      await user.click(
        await screen.findByRole("button", { name: "Cancel new photo" }),
      );
      expect(await screen.findByText(SEED_LINE)).toBeInTheDocument();
    });

    it("shows KB below one megabyte", () => {
      render(
        <PhotoFormDialog
          seed={{
            mode: "edit",
            photo: photo({
              fullHash: "aaaaaaaaaaaaaaaa",
              originalBytes: 48 * 1024,
            }),
          }}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText("Original: 48 KB")).toBeInTheDocument();
    });

    it("shows no dimensions when the upload could not size the full copy", async () => {
      mocks.upload.mockResolvedValue(
        uploaded({
          originalBytes: 2 * MB,
          fullWidthPx: null,
          fullHeightPx: null,
          fullKey: null,
        }),
      );
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      const user = userEvent.setup();
      const { file, input } = pickFile("new.jpg");
      await user.upload(input, file);
      expect(await screen.findByText("Original: 2.0 MB")).toBeInTheDocument();
    });
  });

  describe("original upload", () => {
    const save = () => screen.getByRole("button", { name: "Save" });

    async function pick(name: string) {
      const user = userEvent.setup();
      const { file, input } = pickFile(name);
      await user.upload(input, file);
      return file;
    }

    async function submitCreate() {
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "complete crop" }));
      await user.type(screen.getByLabelText(/Alt text/), "A mountain");
      await user.click(save());
    }

    it("sends the upload's keys with create", async () => {
      mocks.upload.mockResolvedValue(uploaded());
      mocks.create.mockResolvedValue(undefined);
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      await waitFor(() => expect(save()).toBeEnabled());
      await submitCreate();
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          original: {
            photoId: "pid-1",
            originalKey: "album-originals/pid-1/aaaaaaaaaaaaaaaa.jpg",
            fullKey: "album-full/pid-1/aaaaaaaaaaaaaaaa.webp",
          },
        }),
      );
    });

    it("starts uploading the picked file immediately on create", async () => {
      mocks.upload.mockReturnValue(new Promise(() => undefined));
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      const file = await pick("a.jpg");
      await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
      expect(mocks.upload).toHaveBeenCalledWith({ file });
    });

    it("passes the photo id on edit", async () => {
      mocks.upload.mockReturnValue(new Promise(() => undefined));
      render(
        <PhotoFormDialog
          seed={{ mode: "edit", photo: photo() }}
          onClose={vi.fn()}
        />,
      );
      const file = await pick("a.jpg");
      await waitFor(() =>
        expect(mocks.upload).toHaveBeenCalledWith({ file, photoId: "alb_1" }),
      );
    });

    it("disables Save until the upload resolves", async () => {
      const d = deferred<UploadAlbumOriginalResult>();
      mocks.upload.mockReturnValue(d.promise);
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      expect(await screen.findByText(/Uploading original/)).toBeInTheDocument();
      expect(save()).toBeDisabled();
      d.resolve(uploaded());
      await waitFor(() => expect(save()).toBeEnabled());
      expect(screen.queryByText(/Uploading original/)).not.toBeInTheDocument();
    });

    it("shows the upload error and retries the same file", async () => {
      mocks.upload
        .mockRejectedValueOnce(new Error(UPLOAD_PHOTO_GONE))
        .mockResolvedValueOnce(uploaded());
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      const file = await pick("a.jpg");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        UPLOAD_PHOTO_GONE,
      );
      expect(save()).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
      expect(mocks.upload).toHaveBeenLastCalledWith({ file });
      await waitFor(() => expect(save()).toBeEnabled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("prefills an empty date with 'From the photo'", async () => {
      mocks.upload.mockResolvedValue(uploaded({ takenDate: "2026-03-14" }));
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      expect(await screen.findByDisplayValue("2026-03-14")).toBeInTheDocument();
      expect(screen.getByText("From the photo")).toBeInTheDocument();
    });

    it("never overwrites a date the member typed, so it shows no hint", async () => {
      const d = deferred<UploadAlbumOriginalResult>();
      mocks.upload.mockReturnValue(d.promise);
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      const date = screen.getByLabelText(/Date taken/);
      await userEvent.type(date, "2025-01-02");
      d.resolve(uploaded({ takenDate: "2026-03-14" }));
      await waitFor(() => expect(save()).toBeEnabled());
      expect(date).toHaveValue("2025-01-02");
      expect(screen.queryByText("From the photo")).not.toBeInTheDocument();
    });

    it.each([
      ["a D1 error", new Error("D1_ERROR: no such table: album_photos")],
      ["a dropped connection", new TypeError("Load failed")],
    ])("shows only the generic line for %s", async (_name, err) => {
      mocks.upload.mockRejectedValue(err);
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        UPLOAD_GENERIC_FAILURE,
      );
      expect(
        screen.queryByText(/D1_ERROR|Load failed/),
      ).not.toBeInTheDocument();
    });

    it("replaces the previous photo's date when a new one is picked", async () => {
      mocks.upload
        .mockResolvedValueOnce(uploaded({ takenDate: "2026-03-14" }))
        .mockResolvedValueOnce(uploaded({ takenDate: "2026-05-05" }));
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      expect(await screen.findByDisplayValue("2026-03-14")).toBeInTheDocument();
      await pick("b.jpg");
      expect(await screen.findByDisplayValue("2026-05-05")).toBeInTheDocument();
      expect(screen.getByText("From the photo")).toBeInTheDocument();
    });

    it("clears the photo's date when the new photo is cancelled", async () => {
      mocks.upload.mockResolvedValue(uploaded({ takenDate: "2026-03-14" }));
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      expect(await screen.findByDisplayValue("2026-03-14")).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: "Cancel new photo" }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText(/Date taken/)).toHaveValue(""),
      );
    });

    it("keeps a date the member edited when a new photo is picked", async () => {
      mocks.upload
        .mockResolvedValueOnce(uploaded({ takenDate: "2026-03-14" }))
        .mockResolvedValueOnce(uploaded({ takenDate: "2026-05-05" }));
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      await screen.findByDisplayValue("2026-03-14");
      const date = screen.getByLabelText(/Date taken/);
      await userEvent.clear(date);
      await userEvent.type(date, "2025-01-02");
      await pick("b.jpg");
      await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(date).toHaveValue("2025-01-02");
      expect(screen.queryByText("From the photo")).not.toBeInTheDocument();
    });

    it("lets an edit save again once a failed new photo is cancelled", async () => {
      mocks.upload.mockRejectedValue(new Error(UPLOAD_PHOTO_GONE));
      render(
        <PhotoFormDialog
          seed={{ mode: "edit", photo: photo() }}
          onClose={vi.fn()}
        />,
      );
      await pick("a.jpg");
      await screen.findByRole("alert");
      expect(save()).toBeDisabled();
      await userEvent.click(
        screen.getByRole("button", { name: "Cancel new photo" }),
      );
      await waitFor(() => expect(save()).toBeEnabled());
    });

    // A failed save deletes the keys it was sent (the server can't tell
    // a retry from an abandoned upload), so the dialog must not resend
    // them: it uploads the same file again and saves with the new keys.
    it("re-uploads the original after a failed save and saves with the new keys", async () => {
      const retry = deferred<UploadAlbumOriginalResult>();
      mocks.upload
        .mockResolvedValueOnce(uploaded())
        .mockReturnValueOnce(retry.promise);
      mocks.create
        .mockRejectedValueOnce(new Error("Couldn't save the photo."))
        .mockResolvedValueOnce(undefined);
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      const file = await pick("a.jpg");
      await waitFor(() => expect(save()).toBeEnabled());
      await submitCreate();

      await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
      expect(mocks.upload).toHaveBeenLastCalledWith({ file });
      expect(save()).toBeDisabled();
      retry.resolve(
        uploaded({
          photoId: "pid-2",
          originalKey: "album-originals/pid-2/cccccccccccccccc.jpg",
          fullKey: "album-full/pid-2/cccccccccccccccc.webp",
        }),
      );
      await waitFor(() => expect(save()).toBeEnabled());
      await userEvent.click(save());
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
      expect(mocks.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          original: {
            photoId: "pid-2",
            originalKey: "album-originals/pid-2/cccccccccccccccc.jpg",
            fullKey: "album-full/pid-2/cccccccccccccccc.webp",
          },
        }),
      );
    });

    it("an impossible date shows a toast and does not save", async () => {
      mocks.upload.mockResolvedValue(uploaded());
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      await waitFor(() => expect(save()).toBeEnabled());
      const date = screen.getByLabelText<HTMLInputElement>(/Date taken/);
      // jsdom's type=date sanitizes an impossible date to "", so switch
      // the input to text first, as a browser without a picker would be.
      date.type = "text";
      fireEvent.change(date, { target: { value: "2024-02-30" } });
      await submitCreate();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Enter a real date, or leave it blank.",
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("does not re-upload after a failed save that sent no original", async () => {
      mocks.update.mockRejectedValueOnce(new Error("Couldn't save the photo."));
      render(
        <PhotoFormDialog
          seed={{ mode: "edit", photo: photo() }}
          onClose={vi.fn()}
        />,
      );
      await userEvent.click(save());
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
      await act(async () => {});
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(save()).toBeEnabled();
    });

    it("ignores a superseded upload's reply", async () => {
      const a = deferred<UploadAlbumOriginalResult>();
      const b = deferred<UploadAlbumOriginalResult>();
      mocks.upload
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise);
      mocks.create.mockResolvedValue(undefined);
      render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);
      await pick("a.jpg");
      await pick("b.jpg");
      await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
      b.resolve(
        uploaded({
          photoId: "pid-b",
          originalKey: "album-originals/pid-b/bbbbbbbbbbbbbbbb.jpg",
          fullKey: null,
          takenDate: "2026-02-02",
        }),
      );
      await waitFor(() => expect(save()).toBeEnabled());
      a.resolve(
        uploaded({
          photoId: "pid-a",
          takenDate: "2020-01-01",
        }),
      );
      await act(async () => {});
      expect(screen.getByLabelText(/Date taken/)).toHaveValue("2026-02-02");

      await submitCreate();
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          original: {
            photoId: "pid-b",
            originalKey: "album-originals/pid-b/bbbbbbbbbbbbbbbb.jpg",
            fullKey: null,
          },
        }),
      );
    });
  });
});
