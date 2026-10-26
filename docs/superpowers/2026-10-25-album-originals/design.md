# Album originals: keep the uploaded photo, show members the full-size version

Status: approved design, 2026-10-25. Implementation plan to follow.

Picks up #191 strand A4 ("stop discarding originals", storage half only) and #214 Part C1 (prefill `takenAt` from EXIF).

## Goals

1. **Stop throwing the original away.** Every new Album upload keeps the bytes the browser handed us, privately.
2. **Members can see and download the full photo.** Approved members (`role_member`, granted when an officer approves a registration, not merely on sign-up) can switch the lightbox from the 4:3 crop to the uncropped, full-resolution image, and download it. Anonymous visitors see what they see today.
3. **No location leaks.** What members get is a re-encoded copy with every byte of metadata gone. The raw file, GPS and all, is never served to anyone.
4. **Prefill the photo date** from the original's EXIF, on the server.

Nice-to-have, **out of scope**: re-cropping or generating new sizes from the stored original. Keeping the raw file is what makes that possible later.

## Decisions

| Question                       | Decision                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which surfaces                 | **Album only.** Avatars, sponsor logos, landing images, gear thumbnails and feedback screenshots keep their current pipelines                                                                                                          |
| Primary purpose                | Viewers seeing and downloading the full photo. Re-cropping is a nice-to-have, not built here                                                                                                                                           |
| Who sees the full-size version | **Approved members**, via a new permission `public_album:view_original`, **not** `anonymous_grantable`, seeded on `role_member`                                                                                                        |
| What they get                  | A **clean copy**: correctly rotated, every piece of metadata stripped, re-encoded as **WebP**. The raw upload stays private to the system, with no read route                                                                          |
| How the clean copy is made     | The Cloudflare **Images binding** (`env.IMAGES`), once, at upload time, with the result stored. Not on demand: storage is cheap and an on-view transform adds a cold path and a second billable event                                  |
| Clean-copy format              | **WebP, and only WebP.** See [The JPEG trap](#the-jpeg-trap)                                                                                                                                                                           |
| Upload transport               | A **server function taking `FormData`**, not a raw `/api` route. `createCsrfMiddleware` in `src/start.ts` filters on `handlerType === "serverFn"`, so a file route would have no cross-site protection                                 |
| Photo date                     | The **calendar date** from `DateTimeOriginal`, read on the server by a small parser of our own. No time-zone guess, since the date the camera showed is the date the photo was taken. `exifr` is not adopted (unmaintained since 2022) |
| GPS (#214 C2)                  | **Not extracted.** It stays inside the private raw files and can be read later, for every photo uploaded after this ships, if the map earns a yes                                                                                      |
| Photos uploaded before this    | Have no original. The UI shows no full-size controls for them. No backfill is possible                                                                                                                                                 |

## Probe results (2026-10-25)

A throwaway Worker with an `IMAGES` binding ran under `wrangler dev --remote` against the club's Cloudflare account, using a 400×200 JPEG tagged `Orientation: 6` with GPS, `DateTimeOriginal`, `Make` and `Copyright`. The probe Worker was never deployed (Cloudflare reports `code: 10007` for its name).

| Output | Rotation applied                         | Metadata in the output                                                          |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| WebP   | Yes: 200×400, colours in the right place | **None**: no EXIF segment, no GPS IFD                                           |
| JPEG   | Yes                                      | **GPS IFD, `DateTimeOriginal` and `Make` all kept**; only `Orientation` removed |

- The binding is enabled on the account. No plan change is needed.
- **Local mode differs.** `wrangler dev` and the vitest pool run the binding through `sharp` in miniflare. That mode supports only `width`, `height`, `rotate` and `format`, ignores `quality`, and **does not apply EXIF orientation**. Locally, a sideways-tagged photo's clean copy comes out sideways. Production is correct. `wrangler dev --remote` matches production.
- Limits: `.input()` accepts up to 20 MB, above our 12 MB cap. The Free plan allows 5,000 unique transformations a month. Past that, new ones fail with error `9422`, and nothing is charged.

### The JPEG trap

Cloudflare's docs say transformations default to `metadata: copyright`, keeping only the copyright tag. **Through the binding that is false for JPEG output: GPS survives.** The binding's `ImageOutputOptions` has no `metadata` field to ask for anything else. WebP output carries no metadata at all.

So the clean copy is WebP, and the code that chooses the format says why, linking this section. "Serve a JPEG for compatibility" would quietly publish members' locations. Current iOS, Android, macOS and Windows all open WebP.

That WebP drops everything was probed with JPEG input only, so the clean copy is checked rather than trusted: after rendering, the code walks the output's RIFF chunks (bounded) and throws on an `EXIF` or `XMP ` chunk, or on output it can't walk. A throw is treated like any other render failure (`fullKey: null` on upload, a 404 from self-repair), so the failure mode is a missing full-size view, never a leak.

## Storage and data

### R2 layout (private bucket)

| Prefix                                              | Holds                                                                      | Served?                      |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| `album-originals/<photoId>/<hash>.<jpg\|png\|webp>` | The raw bytes exactly as received, with the uploaded type as `contentType` | **Never.** No route reads it |
| `album-full/<photoId>/<hash>.webp`                  | The clean copy. Width, height and size in `customMetadata`                 | Members-only route, below    |

- `<hash>` is `shortContentHash` of **the raw original's bytes**, in both keys. The clean copy reuses the original's hash rather than hashing its own output, so its URL is known before it exists (see [Self-repair](#self-repair)).
- The public `gallery/<id>/<hash>.webp` crop is unchanged: same bucket, CDN and `Cache-Control`.
- **The photo ID is minted at upload.** The upload action generates the `album_photos.id` (uuidv7) and writes the raw file under it. Create then reuses that ID. R2 has no rename, so this avoids a staging prefix and a copy. An upload never saved is an object no row references.
- **Both prefixes join `sweepOrphanPrivateR2Keys`** in `src/server/cron/retention.server.ts`, and `loadReferencedPrivateR2Keys` learns the two new columns. Their age guard is a day, not the five minutes screenshots get: the upload lands on pick and the row on Save, and between the two a member is cropping and captioning, so a dialog left open over the daily sweep must not lose its upload.

### Schema (one add-only migration via `db:generate`)

New nullable columns on `album_photos`:

| Column                  | Type    | Notes                                         |
| ----------------------- | ------- | --------------------------------------------- |
| `original_key`          | text    | `album-originals/…`; `null` for legacy photos |
| `original_bytes`        | integer |                                               |
| `original_content_type` | text    | `image/jpeg`, `image/png` or `image/webp`     |
| `full_key`              | text    | `album-full/…`; `null` until made             |
| `full_width_px`         | integer |                                               |
| `full_height_px`        | integer |                                               |
| `full_bytes`            | integer |                                               |

The permission row goes in the same change, through `db:generate --custom --name add_album_view_original_permission`. Following `0090`'s pattern, its comment explains why it is not anonymous-grantable, and it adds one `role_permissions` row for `role_member`:

```
public_album:view_original
"Open and download the full-size, uncropped version of Album photos"
```

### Lifecycle

| Event                    | Objects                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create                   | Row points at the uploaded original and clean copy, plus the public crop as now                                                                        |
| Update with a new image  | New original, clean copy and crop. Old keys deleted best-effort after the `UPDATE`, as `gallery/` keys are now. A failed `UPDATE` deletes the new ones |
| Update, text fields only | No object touched                                                                                                                                      |
| Delete                   | All three deleted best-effort. The sweep catches any that fail                                                                                         |
| Upload never saved       | Swept as an orphan                                                                                                                                     |

## Upload flow

### Client

`photo-form-dialog.tsx`, through a new `use-upload-album-original.ts` hook. CLAUDE.md forbids inline `useMutation`. This mutation invalidates nothing, because no row exists yet.

1. On file pick, the dialog **starts the upload immediately** and in parallel runs the existing `useImageCrop` flow. The crop and the public 1600×1200 WebP are unchanged.
2. A progress line shows under the crop preview. **Save stays disabled until the upload resolves.** A failed upload shows `imageUploadErrorMessage(err)` and offers "Try again", which re-sends the same `File`.
3. Choosing a different file cancels the earlier result. A late reply for a superseded file is ignored, keyed by a per-pick counter.
4. On success the dialog holds `{ photoId, originalKey, fullKey }` and sends them with create or update. If that save fails, the server has deleted those objects, so the dialog uploads the same `File` again for fresh keys, with Save disabled until they land, and keeps the failure toast.
5. **Date prefill:** if the response has `takenDate` and the date field is still empty, the field is set and a "From the photo" hint shows. The member can edit or clear it. A date the member typed is never overwritten.

The client-side `MAX_SOURCE_BYTES` check (12 MB) still runs first, so an oversized file never uploads.

### Server: `uploadAlbumOriginalAction` (`album-actions.server.ts`)

The shell in `album-fns.ts` is a one-line handler validating `FormData` with fields `file` and an optional `photoId` (edit reuses the existing row's ID). It:

1. Calls `requireAlbumManager()`.
2. Rejects a missing file, more than `MAX_SOURCE_BYTES`, a declared type outside JPEG/PNG/WebP, or **magic bytes that don't match** the declared type.
3. For edit, checks the `photoId` names an existing row. For create, mints a uuidv7.
4. Writes the raw bytes to `album-originals/<id>/<hash>.<ext>`.
5. Runs `getImages().input(stream).output({ format: "image/webp", quality: 90 })` and writes the result to `album-full/<id>/<hash>.webp`, with `widthPx`, `heightPx` and `bytes` from the binding's output as `customMetadata`.
6. Reads the date with `readExifCaptureDate(bytes)`.
7. Returns `{ photoId, originalKey, fullKey: string | null, takenDate: string | null }`, the date as an ISO `YYYY-MM-DD`.

**If step 5 fails** (`9422`, an outage, a file the binding rejects), the error is logged and the upload still succeeds with `fullKey: null`. The member never sees it. [Self-repair](#self-repair) fills it in later. **If step 4 fails**, the upload fails.

### Server: create and update

`createAlbumPhotoAction` and `updateAlbumPhotoAction` gain optional `photoId`, `originalKey` and `fullKey` inputs, and **do not trust them**. Each key must:

- match `album-originals/<photoId>/<hex>.<jpg|png|webp>` or `album-full/<photoId>/<hex>.webp`, for **the same `photoId`**, which on update must also be the row being edited;
- exist (`head`) in the private bucket. Sizes, content type and dimensions are read from the object, never from the client.

Create without these fields still works and stores no original. That keeps the action backwards-compatible inside the deploy window and keeps current tests valid.

### `getImages()`

A new accessor beside `getDb()` / `getPrivateBucket()`, following the never-at-module-scope rule, and the one place tests swap in a fake. The binding is added to both environments in `wrangler.jsonc` as `"images": { "binding": "IMAGES" }`, and **`scripts/wrangler-env.ts` learns it**, or `sync-env` refuses the file. No Pulumi change: the binding is not a resource.

## Photo date (#214 C1)

### `readExifCaptureDate(bytes): Temporal.PlainDate | null`

`src/server/r2/exif-date.server.ts` holds a read-only parser of our own.

- **Containers:**
  - JPEG: `APP1` with `Exif\0\0`.
  - PNG: the `eXIf` chunk.
  - WebP: `RIFF` with an `EXIF` chunk.
- **TIFF:** both byte orders. Follows IFD0's `ExifIFDPointer` (`0x8769`) to `DateTimeOriginal` (`0x9003`), falling back to IFD0 `DateTime` (`0x0132`).
- **Value:** `"YYYY:MM:DD HH:MM:SS"`. Only the date part is used, through `Temporal.PlainDate.from`, so an impossible date gives `null`.
- **Hostile input:** every offset is bounds-checked, segment and chunk walks are capped at a fixed count, and IFD entry counts are capped. Any failure returns `null` and never throws.

Nothing else is read. No GPS, camera fields or offset.

### Why a date, and why UTC

`album_photos.taken_at` is a timestamp, but every reader treats it as a calendar date. The form writes `new Date("YYYY-MM-DD")`, which is UTC midnight. `photo-grid.tsx` reads the year with `toZonedDateTimeISO("UTC")`, and `toDateInputValue` defaults to UTC. It round-trips today. **This is a bare calendar date encoded as UTC midnight, and it stays that way.** Moving it to `CLUB_TIME_ZONE` would show every existing photo a day early. CLAUDE.md's club-time-zone rule is about real moments in time, which this value is not.

The change makes that encoding deliberate rather than incidental:

- `photo-form-dialog.tsx` builds the value with `Temporal.PlainDate.from(form.takenAt).toZonedDateTime("UTC")` and sends that instant, instead of `new Date(form.takenAt)`.
- A comment at both ends names the convention.

The EXIF date is used as-is, with no zone conversion. A photo taken at 23:00 in Utah is dated the day the photographer saw, which is the right answer for an album.

## Viewing

### Route: `GET /api/album-full/$publicId/$hash.webp`

`src/routes/api/album-full.$publicId.$hash.ts`, shaped like `site-feedback.$id.screenshot.ts`, with `getAlbumFullImageAction(publicId, hash, { download })`:

- **Permission:** loads the principal and checks `public_album:view_original` with `effectivePermissions(principal, readViewAsCookie(), …)`, as the screenshot action does.
- **One 404 for everything:**
  - signed out;
  - no permission;
  - unknown `publicId`;
  - legacy photo;
  - `hash` not the current one.

  All of these send the same body and `Cache-Control: private, no-store`, so the route says nothing about which photos have originals.

- **Success:** `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable` (safe because `hash` changes with the content; `private` keeps it out of the CDN), `X-Content-Type-Options: nosniff`, and `Content-Disposition: inline`. With `?download=1`, it sends `attachment; filename="ucmc-<publicId>.webp"` instead.

### Self-repair

If the row has `original_key` but `full_key` is `null`, the action:

1. generates the clean copy from the original with the same call as upload;
2. writes it;
3. sets `full_key` and its three columns, with a guarded `UPDATE … WHERE full_key IS NULL`, so two racing viewers can't clobber each other;
4. serves it.

If generation fails, it returns the same 404 and logs the error. A month that ran out of the free limit therefore repairs itself the next month.

Self-repair means `fullHash` in the payload has to exist before `full_key` does. So `fullHash` is derived from **the original's hash**: the full copy's key reuses the original's hash, `album-full/<id>/<originalHash>.webp`, not a hash of the WebP bytes. The URL is known as soon as an original exists, and it still changes whenever the image is replaced.

### Payload

`AlbumPhotoSummary` gains `fullHash: string | null`, the original's hash, or `null` for legacy photos. It is visible to everyone who can see the album, and harmless, since the route enforces access.

**The field says whether a full-size copy exists, never whether you may see it.** Whether to show the controls is decided by `hasPermission(principal, "public_album:view_original")` (CLAUDE.md: never the presence of a payload field). That keeps role emulation honest.

### Lightbox (`photo-lightbox.tsx`)

Shown only when the viewer `hasPermission` **and** `fullHash !== null`:

- **"Show original" toggle.** It swaps the image to the full-size URL, fitted with `object-contain` inside the existing `flex-1 min-h-0` area, and back. The crop stays on screen with a small spinner until the full image's `onLoad`, so nothing flashes. Prev and next reset to the crop.
- **"Download".** A link to the same URL with `?download=1`.

Everyone else sees today's lightbox, unchanged. No "sign in to see full size" nudge in this change.

### Edit dialog

For an existing photo, a line beside the crop preview reads "Original: 4032 × 3024 · 3.1 MB", or "No original stored" for legacy photos. A fresh upload shows the same line once the upload resolves. Officers get no download of the raw file.

## Privacy and compliance (raise, don't edit)

From this change, the club stores **members' raw uploaded photos, with whatever location and camera metadata they carry**, privately, for as long as the photo is in the Album. Nothing exposes that metadata, but it is held.

- `/privacy` (`src/config/legal.ts`) must be checked for whether its current text covers this. If not, **draft wording goes to legal review in the PR description**. `legal.ts` is not edited in this change.
- The [compliance wiki](https://github.com/SpencerAWill/ucmc.spencerwill.com/wiki/Compliance) gets an entry covering what is stored, where, who can read it (no one through the app), how long, and how it is deleted.

## Testing

The Images binding is reached only through `getImages()`. Tests replace it with a fake that echoes a fixed WebP, or throws.

| Area             | Cases                                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXIF date parser | **Bytes built in the test**, not checked-in fixtures:<br>• JPEG in `II` and `MM` byte order; PNG `eXIf`; WebP `EXIF`<br>• `DateTime` fallback; no EXIF; date absent<br>• impossible date; truncated segments; offsets past the end; looping IFD pointers<br>All return `null` without throwing. **Mutation-checked.** |
| Upload action    | • Needs `public_album:manage`<br>• 12 MB cap; type and magic-byte mismatch<br>• Edit with an unknown `photoId`<br>• Writes both objects with the right content types and metadata<br>• If the fake binding throws: original stored, `fullKey: null`<br>• Date returned                                                |
| Create / update  | • Rejects a wrong-shape key, another photo's ID, or a missing object<br>• Reads sizes from R2<br>• Create without originals still works<br>• Replacing an image deletes the old keys<br>• A text-only edit touches nothing                                                                                            |
| Read route       | • All five 404 cases send the same response<br>• Success headers; `?download=1` disposition<br>• Self-repair writes and fills `full_key`; the guarded `UPDATE` loses a race without error<br>• Self-repair failure gives a 404                                                                                        |
| Orphan sweep     | New prefixes swept; referenced keys kept; young orphans kept                                                                                                                                                                                                                                                          |
| Delete           | All three objects removed                                                                                                                                                                                                                                                                                             |
| Lightbox (jsdom) | • Controls follow `hasPermission`, including under emulation<br>• Hidden when `fullHash` is `null`<br>• Toggle swaps `src` and keeps the crop until load<br>• Download link                                                                                                                                           |
| Form (jsdom)     | Prefill fills an empty date and never overwrites a typed one; a superseded upload's reply is ignored; Save disabled while uploading                                                                                                                                                                                   |
| Migration        | `db:drift` clean; DDL only adds; the permission row is not anonymous-grantable and is granted to `role_member`                                                                                                                                                                                                        |

Run the narrowest `vitest` file per change, then `pnpm verify` before the PR.

### Manual check on the dev stack (required)

Tests can't prove rotation or stripping: the pool uses `sharp`, which applies neither. After `Deploy — dev`:

1. Upload a phone photo that is stored sideways (EXIF `Orientation` ≠ 1) and carries GPS.
2. Signed in as a member, open "Show original". It must display upright. Download it and confirm **no EXIF segment and no GPS IFD**, with the probe's inspect script or `exiftool`.
3. Signed out, the full-size URL returns 404.

The PR description records the result. Prod waits on it.

## Delivery

**One PR**, as a sequence of commits, each green and independently revertable:

1. **Photo date:** `readExifCaptureDate`, the explicit UTC-midnight conversion in the form, and their tests. Useful alone, though the prefill is wired in commit 3.
2. **Storage:** the migration (columns plus permission), the key helpers for both prefixes, the sweep prefixes and live-key loader, and delete of all three objects.
3. **Upload:** the `IMAGES` binding in `wrangler.jsonc` and `wrangler-env.ts`, `getImages()`, `uploadAlbumOriginalAction` and its shell and hook, key validation in create and update, and the dialog's upload, progress and prefill.
4. **Viewing:** the route, `getAlbumFullImageAction`, self-repair, and `fullHash` in the payload.
5. **UI and docs:** the lightbox toggle and download, the edit-dialog original line, and the rules and docs below.

`knip` may need an entry for the new route file. Check `knip.config.ts` rather than assume.

## Rules and docs to update with the code

- **New `.claude/rules/feature-album.md`** (`paths: apps/ucmc-web/src/features/album/**`) carrying the easy-to-break facts:
  - the clean copy is WebP only, and [The JPEG trap](#the-jpeg-trap);
  - the photo ID is minted at upload;
  - the full key reuses the original's hash;
  - all 404 cases must send the same response;
  - `taken_at` is a calendar date stored as UTC midnight;
  - local mode does not apply EXIF orientation.
- `.claude/rules/data/r2.md`: the two private prefixes and their place in the private sweep.
- README and CLAUDE.md change only if they list Worker bindings. Check both.

## After the PR (with the owner's okay)

- **#214:** comment that C1 shipped here, and re-scope C2 to "extract GPS from the stored raw files". Include the probe's JPEG-keeps-GPS finding, which corrects the docs.
- **#191:** comment that A4's storage-of-originals half is done. Transformations and `srcset` stay open there.

## Out of scope

- Re-cropping or regenerating sizes from the stored original.
- A responsive `srcset` for the public crop.
- Originals for any surface other than the Album.
- GPS extraction, storage or display, and the photo map (#214 C2/C3).
- HEIC uploads. `IMAGE_UPLOAD_ACCEPT` is unchanged.
- Backfilling originals for existing photos, which is impossible.
- A "sign in to see full size" prompt for anonymous visitors.
