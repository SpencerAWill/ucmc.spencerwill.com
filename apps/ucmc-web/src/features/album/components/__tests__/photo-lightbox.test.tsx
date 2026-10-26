import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhotoLightbox } from "#/features/album/components/photo-lightbox";
import { albumFullUrl } from "#/features/album/lib/image-url";
import type { AlbumPhotoSummary } from "#/features/album/server/album-fns";

const auth = vi.hoisted(() => ({ hasPermission: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));

// `principal.permissions` holds the permission on purpose: the lightbox must
// ask `hasPermission`, which is what role emulation answers.
vi.mock("#/features/auth/api/use-auth", () => ({
  useAuth: () => ({
    principal: { permissions: ["public_album:view_original"] },
    hasPermission: auth.hasPermission,
  }),
}));

vi.mock("#/config/env", () => ({ env: { VITE_R2_PUBLIC_HOST: undefined } }));

function photo(overrides: Partial<AlbumPhotoSummary> = {}): AlbumPhotoSummary {
  return {
    id: "alb_1",
    publicId: "abc123",
    caption: null,
    credit: null,
    takenAt: null,
    tag: null,
    altText: "A climber",
    imageKey: "gallery/alb_1/a1b2c3d4e5f60718.webp",
    imageBytes: 120_000,
    widthPx: 1600,
    heightPx: 1200,
    fullHash: "aaaaaaaaaaaaaaaa",
    originalBytes: 3_000_000,
    fullWidthPx: 4000,
    fullHeightPx: 3000,
    ...overrides,
  };
}

// jsdom never loads images. Stand-in for the preloader's `new Image()` that
// records each instance so a test can fire load or error by hand.
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    FakeImage.instances.push(this);
  }
}

function preloaded(src: string): FakeImage {
  const found = FakeImage.instances.find((i) => i.src === src);
  if (!found) {
    throw new Error(`no preload for ${src}`);
  }
  return found;
}

const FULL_SRC = albumFullUrl("abc123", "aaaaaaaaaaaaaaaa");

function renderBox(photos: AlbumPhotoSummary[], onChange = vi.fn()) {
  return render(
    <PhotoLightbox
      photos={photos}
      activePublicId={photos[0].publicId}
      onClose={vi.fn()}
      onChange={onChange}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PhotoLightbox original controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeImage.instances = [];
    vi.stubGlobal("Image", FakeImage);
    auth.hasPermission.mockImplementation(
      (p: string) => p === "public_album:view_original",
    );
  });

  it("shows Show original and Download to a viewer with the permission", () => {
    renderBox([photo()]);
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "Download" })).toBeInTheDocument();
  });

  it("hides the controls when hasPermission says no, whatever principal.permissions holds", () => {
    auth.hasPermission.mockReturnValue(false);
    renderBox([photo()]);
    expect(
      screen.queryByRole("button", { name: "Show original" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Download" }),
    ).not.toBeInTheDocument();
  });

  it("hides the controls for a photo with no fullHash", () => {
    renderBox([photo({ fullHash: null })]);
    expect(
      screen.queryByRole("button", { name: "Show original" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Download" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the crop on screen until the full image loads, then swaps", () => {
    renderBox([photo()]);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Loading full-size photo")).toBeInTheDocument();

    const crop = document.querySelector<HTMLImageElement>(
      'img[src*="a1b2c3d4e5f60718"]',
    );
    expect(crop).not.toBeNull();
    expect(crop).toBeVisible();
    expect(
      document.querySelector(`img[src="${FULL_SRC}"]`),
    ).not.toBeInTheDocument();

    act(() => {
      preloaded(FULL_SRC).onload?.();
    });
    expect(
      document.querySelector(`img[src="${FULL_SRC}"]`),
    ).toBeInTheDocument();
    expect(
      document.querySelector('img[src*="a1b2c3d4e5f60718"]'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading full-size photo"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the crop and turns the toggle off when the full image fails", () => {
    renderBox([photo()]);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    act(() => {
      preloaded(FULL_SRC).onerror?.();
    });
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      document.querySelector(`img[src="${FULL_SRC}"]`),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('img[src*="a1b2c3d4e5f60718"]'),
    ).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn't load the full-size photo.",
    );
  });

  it("goes back to the crop when the pressed toggle is clicked again", () => {
    renderBox([photo()]);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    act(() => {
      preloaded(FULL_SRC).onload?.();
    });
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('img[src*="/api/album-full/"]')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("links Download to the full URL with download=1", () => {
    renderBox([photo()]);
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      albumFullUrl("abc123", "aaaaaaaaaaaaaaaa", { download: true }),
    );
  });

  it("returns to the crop when navigating to another photo", () => {
    const a = photo();
    const b = photo({
      id: "alb_2",
      publicId: "def456",
      fullHash: "bbbbbbbbbbbbbbbb",
    });
    const { rerender } = renderBox([a, b]);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    act(() => {
      preloaded(FULL_SRC).onload?.();
    });
    expect(
      document.querySelector(`img[src="${FULL_SRC}"]`),
    ).toBeInTheDocument();

    rerender(
      <PhotoLightbox
        photos={[a, b]}
        activePublicId="def456"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('img[src*="/api/album-full/"]')).toBeNull();
  });

  it("ignores a load that lands after navigating away mid-load", () => {
    const a = photo();
    const b = photo({
      id: "alb_2",
      publicId: "def456",
      fullHash: "bbbbbbbbbbbbbbbb",
    });
    const { rerender } = renderBox([a, b]);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    const stale = preloaded(FULL_SRC);

    rerender(
      <PhotoLightbox
        photos={[a, b]}
        activePublicId="def456"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    // The cleanup detached the handlers, so the late load is a no-op.
    expect(stale.onload).toBeNull();
    act(() => {
      stale.onload?.();
    });
    expect(document.querySelector('img[src*="/api/album-full/"]')).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  function lightbox(
    photos: AlbumPhotoSummary[],
    activePublicId: string | null,
  ) {
    return (
      <PhotoLightbox
        photos={photos}
        activePublicId={activePublicId}
        onClose={vi.fn()}
        onChange={vi.fn()}
      />
    );
  }

  it("is off again after going A to B and back to A", () => {
    const a = photo();
    const b = photo({
      id: "alb_2",
      publicId: "def456",
      fullHash: "bbbbbbbbbbbbbbbb",
    });
    const { rerender } = render(lightbox([a, b], "abc123"));
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    act(() => {
      preloaded(FULL_SRC).onload?.();
    });
    rerender(lightbox([a, b], "def456"));
    rerender(lightbox([a, b], "abc123"));
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('img[src*="/api/album-full/"]')).toBeNull();
  });

  it("is off again after closing and reopening the same photo", () => {
    const a = photo();
    const { rerender } = render(lightbox([a], "abc123"));
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    act(() => {
      preloaded(FULL_SRC).onload?.();
    });
    rerender(lightbox([a], null));
    rerender(lightbox([a], "abc123"));
    expect(
      screen.getByRole("button", { name: "Show original" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('img[src*="/api/album-full/"]')).toBeNull();
  });
});
