/**
 * Save, when the cropped image can't be encoded.
 *
 * iOS Safari can't encode a canvas as WebP, so `getCroppedDataUrl` throws
 * an `ImageUploadError` on every iPhone. The encode used to sit outside
 * `submit`'s `try`, and `submit` runs as `void submit()`, so the throw
 * became an unhandled rejection: tapping Save did nothing and said
 * nothing. The member has to be told why.
 *
 * Its own file because it mocks `useImageCrop`, and the sibling suite
 * exists to exercise the real hook's referential stability.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PhotoFormDialog } from "#/features/album/components/photo-form-dialog";
import { ImageUploadError } from "#/lib/image-upload";

const { createPhoto, toastError, crop } = vi.hoisted(() => {
  const noop = () => {};
  return {
    createPhoto: vi.fn(),
    toastError: vi.fn(),
    crop: {
      workingUrl: "blob:picked",
      error: null,
      crop: undefined,
      imgRef: { current: null },
      fileInputRef: { current: null },
      hasCompletedCrop: true,
      openPicker: noop,
      reset: noop,
      fileInputProps: {
        type: "file" as const,
        accept: "image/png,image/jpeg,image/webp",
        className: "hidden",
        onChange: noop,
      },
      reactCropProps: {
        crop: undefined,
        onChange: noop,
        onComplete: noop,
        aspect: 4 / 3,
        keepSelection: true as const,
      },
      imgProps: {
        ref: { current: null },
        src: "blob:picked",
        alt: "Image to crop",
        onLoad: noop,
        className: "",
      },
      getCroppedDataUrl: vi.fn<() => Promise<string | null>>(),
    },
  };
});

vi.mock("#/hooks/use-image-crop", () => ({ useImageCrop: () => crop }));
vi.mock("#/features/album/api/use-album-mutations", () => ({
  useCreateAlbumPhoto: () => ({ mutateAsync: createPhoto, isPending: false }),
  useUpdateAlbumPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));
vi.mock("#/config/env", () => ({ env: { VITE_R2_PUBLIC_HOST: undefined } }));

beforeEach(() => {
  createPhoto.mockReset();
  toastError.mockReset();
  crop.getCroppedDataUrl.mockReset();
});

describe("PhotoFormDialog save", () => {
  it("tells the member why, when the image can't be encoded", async () => {
    const message =
      "This browser can’t save images in WebP format, which this upload requires.";
    crop.getCroppedDataUrl.mockRejectedValue(new ImageUploadError(message));
    const user = userEvent.setup();
    render(<PhotoFormDialog seed={{ mode: "create" }} onClose={vi.fn()} />);

    await user.type(
      screen.getByLabelText("Alt text (required)"),
      "Two climbers on a ridge",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    expect(createPhoto).not.toHaveBeenCalled();
  });
});
