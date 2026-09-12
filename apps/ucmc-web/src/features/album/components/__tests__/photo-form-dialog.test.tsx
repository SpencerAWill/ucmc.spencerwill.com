import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PhotoFormDialog } from "#/features/album/components/photo-form-dialog";
import type { AlbumPhotoSummary } from "#/features/album/server/album-fns";

vi.mock("#/features/album/api/use-album-mutations", () => ({
  useCreateAlbumPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAlbumPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    ...overrides,
  };
}

describe("PhotoFormDialog", () => {
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
});
