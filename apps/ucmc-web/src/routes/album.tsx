import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePageEnabled } from "#/features/settings/api/page-guards";
import { albumListQueryOptions } from "#/features/album/api/queries";
import { useDeleteAlbumPhoto } from "#/features/album/api/use-album-mutations";
import { PhotoFormDialog } from "#/features/album/components/photo-form-dialog";
import type { PhotoFormSeed } from "#/features/album/components/photo-form-dialog";
import { PhotoGrid } from "#/features/album/components/photo-grid";
import { PhotoLightbox } from "#/features/album/components/photo-lightbox";
import type { AlbumPhotoSummary } from "#/features/album/server/album-fns";

/**
 * Search params for /album. Only `photo` lives in the URL — the
 * lightbox is opened when this is set to a known publicId, so a
 * shared `?photo=abc` link reliably opens the lightbox at that
 * photo on first paint. Filter state (year / tag) is kept in
 * component-local `useState` inside PhotoGrid.
 */
const albumSearchSchema = z.object({
  photo: z.string().optional(),
});

/**
 * Public /album index. View gated by `public_album:view`
 * (default-granted to role_anonymous + role_member). Manage UX
 * (Add Photo button + pencil / trash on each tile) gated by
 * `public_album:manage`. Clicking a tile opens the lightbox by
 * setting `?photo=$publicId` in the URL; the lightbox reads the
 * search param so a shared link reproduces the state.
 */
export const Route = createFileRoute("/album")({
  validateSearch: albumSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePageEnabled(context.queryClient, "album", "public_album:view");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(albumListQueryOptions());
  },
  component: AlbumPage,
});

function AlbumPage() {
  const { data } = useSuspenseQuery(albumListQueryOptions());
  const { hasPermission } = useAuth();
  const canManage = hasPermission("public_album:manage");
  const { photo: activePublicId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [formSeed, setFormSeed] = useState<PhotoFormSeed | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState<AlbumPhotoSummary | null>(
    null,
  );
  const deleteMut = useDeleteAlbumPhoto();

  function openLightbox(photo: AlbumPhotoSummary) {
    void navigate({
      search: (prev) => ({ ...prev, photo: photo.publicId }),
      replace: false,
    });
  }
  function closeLightbox() {
    void navigate({
      search: (prev) => ({ ...prev, photo: undefined }),
      replace: false,
    });
  }
  function changeLightboxPhoto(publicId: string) {
    // Use `replace: true` for keyboard nav so a long lightbox session
    // doesn't fill the back/forward history with intermediate photos.
    void navigate({
      search: (prev) => ({ ...prev, photo: publicId }),
      replace: true,
    });
  }

  const knownTags = Array.from(
    new Set(
      data.photos.map((p) => p.tag).filter((t): t is string => Boolean(t)),
    ),
  ).sort((a, b) => a.localeCompare(b));

  async function confirmDelete() {
    if (deletingPhoto === null) {
      return;
    }
    try {
      await deleteMut.mutateAsync({ publicId: deletingPhoto.publicId });
      toast.success("Photo deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the photo.",
      );
    } finally {
      setDeletingPhoto(null);
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Album</h1>
          <p className="text-sm text-muted-foreground">
            Photos from UCMC trips, by year and tag. Click a tile to see it
            larger.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFormSeed({ mode: "create" })}
            aria-label="Add Album photo"
          >
            <Plus className="size-4" />
            Add photo
          </Button>
        ) : null}
      </header>

      <PhotoGrid
        photos={data.photos}
        canManage={canManage}
        onSelect={openLightbox}
        onEditPhoto={(photo) => setFormSeed({ mode: "edit", photo })}
        onDeletePhoto={(photo) => setDeletingPhoto(photo)}
      />

      <PhotoLightbox
        photos={data.photos}
        activePublicId={activePublicId ?? null}
        onClose={closeLightbox}
        onChange={changeLightboxPhoto}
      />

      {canManage ? (
        <>
          <PhotoFormDialog
            seed={formSeed}
            onClose={() => setFormSeed(null)}
            knownTags={knownTags}
          />
          <AlertDialog
            open={deletingPhoto !== null}
            onOpenChange={(next) => {
              if (!next) {
                setDeletingPhoto(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the row, the cropped image on R2, and the tile
                  from /album. You can re-upload from a fresh file later, but
                  the row's publicId won't be the same.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmDelete();
                  }}
                  disabled={deleteMut.isPending}
                >
                  {deleteMut.isPending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </main>
  );
}
