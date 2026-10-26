# Album Originals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every new Album upload's original privately, show signed-in members a metadata-stripped full-size copy, and prefill the photo date from EXIF.

**Architecture:** On file pick, the browser sends the raw `File` to a `FormData` server function. The function stores the file in `BUCKET_PRIVATE`, has the Cloudflare Images binding render a clean WebP beside it, and returns the photo ID, both keys and the EXIF date. Create and update then verify those keys against R2 and record them on `album_photos`. A members-only Worker route serves the clean copy, generating it on first view if upload-time rendering failed.

**Tech Stack:** TanStack Start server functions, Drizzle + D1, R2, Cloudflare Images binding, Temporal, React 19, Vitest (workers + jsdom pools).

**Spec:** `docs/superpowers/2026-10-25-album-originals/design.md`. Read it first. This plan cites its sections rather than repeating them.

## Global Constraints

- **One PR** off `feat/album-originals`. One commit per task, each green (`pnpm verify` passes at every commit).
- **The clean copy is `image/webp` only.** JPEG output through the binding keeps GPS (spec: "The JPEG trap").
- Clean-copy encode: `output({ format: "image/webp", quality: 90 })`.
- Raw upload cap: `MAX_SOURCE_BYTES` (12 MB) from `#/lib/image-upload`. Accepted types: `image/jpeg`, `image/png`, `image/webp`, checked against magic bytes.
- Private keys: `album-originals/<photoId>/<hash>.<jpg|png|webp>` and `album-full/<photoId>/<hash>.webp`. `<hash>` is `shortContentHash` of the **raw original** in both.
- Permission: `public_album:view_original`, description `Open and download the full-size, uncropped version of Album photos`, id `perm_public_album_view_original`, `anonymous_grantable = 0`, granted to `role_member` only.
- `taken_at` is a calendar date stored as **UTC midnight**. Do not move it to `CLUB_TIME_ZONE`.
- Every "you can't have this" outcome on the full-size route is the same `404` with `Cache-Control: private, no-store`.
- Client gates use `hasPermission` from `useAuth()`, never a payload field or `principal.permissions`.
- Repo invariants apply: `const` only, braces always, `getX()` accessors and never `env.*` at module scope, mutations via `use-*.ts` hooks, migrations only via `db:generate`, no D1 parameter lists that grow with data, and no edits to `src/config/legal.ts`.

## Review Focus

1. **A superseded or abandoned upload:** the member picks a second file while the first is still uploading, or closes the dialog. The late reply must not overwrite the newer one's keys or date, and the stray objects are left for the sweep. Tests: Task 8 "ignores a superseded upload's reply"; Task 4 "keeps a young unreferenced original".
2. **A mislabelled file**, such as HEIC bytes declared `image/jpeg`. Rejected with a message the member can read, and nothing written to R2. Test: Task 6 "rejects HEIC bytes declared as JPEG and writes nothing".
3. **Camera placeholder dates**: `0000:00:00 00:00:00`, all spaces, or a date that doesn't exist. Return `null`, and the field stays empty. Test: Task 1 "returns null for placeholder and impossible dates".
4. **Role emulation:** a manager "viewing as" anonymous must not see Show original or Download, even though their real principal holds the permission. Test: Task 10 "hides the controls when hasPermission says no, whatever principal.permissions holds".
5. **A failed update after a new image was uploaded:** the new keys are cleaned up and the row and old objects are untouched. Test: Task 7 "cleans up new private keys when the UPDATE fails".

---

### Task 1: EXIF capture-date reader

**Files:**

- Create: `apps/ucmc-web/src/server/r2/exif-date.server.ts`
- Test: `apps/ucmc-web/src/server/r2/__tests__/exif-date.test.ts`

**Interfaces:**

- Produces: `readExifCaptureDate(bytes: Uint8Array): Temporal.PlainDate | null`

- [ ] **Step 1: Write the failing tests.** Build the bytes inside the test file with a small `tiff({ order: "II" | "MM", exif?: { DateTimeOriginal?: string }, ifd0?: { DateTime?: string } })` builder, wrapped by `jpegWithApp1(tiff)`, `pngWithExif(tiff)` and `webpWithExif(tiff)`. No checked-in fixtures.

```ts
it("reads DateTimeOriginal from a little-endian JPEG", () => {
  expect(readExifCaptureDate(jpegWithApp1(tiff({ order: "II", exif: { DateTimeOriginal: "2024:09:14 15:42:07" } })))?.toString()).toBe("2024-09-14");
});
it("reads DateTimeOriginal from a big-endian JPEG", ...);       // "MM", same expectation
it("reads the PNG eXIf chunk", ...);                             // "2023:06:01 08:00:00" → "2023-06-01"
it("reads the WebP EXIF chunk", ...);                            // "2022:12:31 23:59:59" → "2022-12-31"
it("falls back to IFD0 DateTime", ...);                          // no Exif IFD; DateTime "2021:03:04 05:06:07" → "2021-03-04"
it("prefers DateTimeOriginal over DateTime", ...);
it("returns null when there is no EXIF", ...);                   // bare SOI+EOI JPEG, bare PNG signature, bare RIFF/WEBP
it("returns null for placeholder and impossible dates", ...);    // "0000:00:00 00:00:00", "                   ", "2024:02:30 00:00:00"
it("returns null for truncated input without throwing", ...);    // every prefix length of a valid JPEG
it("returns null when an offset points past the end", ...);
it("returns null when IFD pointers loop", ...);                  // ExifIFDPointer → IFD0's own offset
```

- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/server/r2/__tests__/exif-date.test.ts` should FAIL because the module isn't found.
- [ ] **Step 3: Implement `readExifCaptureDate`** to the spec's "Photo date" section.
  - Find the TIFF block:
    - JPEG: walk the markers from `FFD8` to the `APP1` whose payload starts with `Exif\0\0`.
    - PNG: walk the chunks to `eXIf`.
    - WebP: walk the RIFF chunks to `EXIF`. Some writers prefix that chunk with `Exif\0\0`, so skip it when present.
  - In the TIFF: read the byte order and IFD0, follow tag `0x8769` to the Exif IFD, read `0x9003`, and fall back to IFD0 `0x0132`.
  - Parse the first 10 characters as `YYYY:MM:DD` with `Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" })`, inside `try`.
  - Bounds: cap the segment/chunk walk at 64 steps and the IFD entry count at 512. Keep a visited set of IFD offsets. Bounds-check every read.
  - Wrap the whole function in `try { … } catch { return null; }`.
- [ ] **Step 4: Run the tests again.** The same command should PASS.
- [ ] **Step 5: Mutation-check.** `pnpm --filter ucmc-web test:mutation -- --mutate src/server/r2/exif-date.server.ts` should report no surviving mutants in the bounds checks or the byte-order switch. Add a test for any that survive.
- [ ] **Step 6: Commit.** `feat(ucmc-web): read the capture date from a photo's EXIF`

### Task 2: Make the photo date's UTC-midnight encoding explicit

**Files:**

- Create: `apps/ucmc-web/src/features/album/lib/taken-date.ts`
- Modify: `apps/ucmc-web/src/features/album/components/photo-form-dialog.tsx` (the `new Date(form.takenAt)` in `submit()`)
- Modify: `apps/ucmc-web/src/features/album/components/photo-grid.tsx` (the two `toZonedDateTimeISO("UTC")` sites: add a comment naming the convention)
- Test: `apps/ucmc-web/src/features/album/lib/__tests__/taken-date.test.ts`

**Interfaces:**

- Produces: `albumTakenDateToWire(value: string): Date`, which takes `YYYY-MM-DD` and returns UTC midnight of that date. The module doc comment carries the spec's "Why a date, and why UTC" reasoning.

- [ ] **Step 1: Write the failing tests.**
  - `albumTakenDateToWire("2024-09-14").toISOString()` is `"2024-09-14T00:00:00.000Z"`.
  - It round-trips through `toDateInputValue(Temporal.Instant.fromEpochMilliseconds(d.getTime()))` to `"2024-09-14"`.
  - `"2024-02-30"` throws.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/features/album/lib/__tests__/taken-date.test.ts`
- [ ] **Step 3: Implement it.** Use `Temporal.PlainDate.from(value, { overflow: "reject" }).toZonedDateTime("UTC").epochMilliseconds`. In `submit()`, replace `new Date(form.takenAt)` with `albumTakenDateToWire(form.takenAt)`.
- [ ] **Step 4: Run it, plus the existing dialog test.** `pnpm --filter ucmc-web exec vitest run src/features/album` should PASS.
- [ ] **Step 5: Commit.** `fix(ucmc-web): build the Album photo date as UTC midnight on purpose`

### Task 3: Schema columns and the `view_original` permission

**Files:**

- Modify: `apps/ucmc-web/drizzle/schema.ts` (`albumPhotos`, around line 2187)
- Create (generated): two migrations under `apps/ucmc-web/drizzle/migrations/` plus their snapshots and journal entries
- Test: `apps/ucmc-web/src/server/auth/__tests__/permission-catalog.test.ts` (new `describe("public_album:view_original")`)

**Interfaces:**

- Produces: `schema.albumPhotos` columns `originalKey`, `originalBytes`, `originalContentType`, `fullKey`, `fullWidthPx`, `fullHeightPx` and `fullBytes`. All are nullable, `text` or `integer` per the spec's Schema table.

- [ ] **Step 1: Write the failing test** next to the `notice:manage` block. It asserts:
  - a `permissions` row with id `perm_public_album_view_original`, the name and description from Global Constraints, and `anonymous_grantable = 0`;
  - exactly one `role_permissions` row for it, with `role_id = 'role_member'`.
- [ ] **Step 2: Run and confirm it fails.** `pnpm --filter ucmc-web exec vitest run src/server/auth/__tests__/permission-catalog.test.ts`
- [ ] **Step 3: Generate the schema migration.** Add the seven nullable columns to `albumPhotos`, then run `pnpm --filter ucmc-web db:generate --name album_photo_originals`. **Review the SQL:** it must be seven `ALTER TABLE album_photos ADD …` statements and no table rebuild (`data/migrations.md`).
- [ ] **Step 4: Generate the permission migration.** Run `pnpm --filter ucmc-web db:generate --custom --name add_album_view_original_permission`. Write the `INSERT OR IGNORE` for the permission and for the single `role_member` grant, with a header comment in `0090`'s style explaining why it isn't anonymous-grantable (spec: members-only, "member" here means an approved member, since `role_member` is granted on approval, no public full-res scraping).
- [ ] **Step 5: Verify.** `pnpm --filter ucmc-web db:drift` should be clean, and the test from Step 2 should PASS.
- [ ] **Step 6: Commit.** `feat(ucmc-web): add Album original columns and public_album:view_original`

### Task 4: Private keys, the orphan sweep, and delete

**Files:**

- Create: `apps/ucmc-web/src/server/r2/album-originals.server.ts`
- Modify: `apps/ucmc-web/src/server/r2/image-codec.server.ts` (export `matchesMagic` as `matchesImageMagic(bytes: Uint8Array, contentType: AcceptedImageContentType): boolean`)
- Modify: `apps/ucmc-web/src/server/cron/retention.server.ts` (`sweepOrphanPrivateR2Keys` prefixes and `loadReferencedPrivateR2Keys`)
- Modify: `apps/ucmc-web/src/features/album/server/album-actions.server.ts` (`deleteAlbumPhotoAction`)
- Test: `apps/ucmc-web/src/server/r2/__tests__/album-originals.test.ts`, `apps/ucmc-web/src/server/cron/__tests__/retention.test.ts`, `apps/ucmc-web/src/features/album/server/__tests__/album-actions.test.ts`

**Interfaces:**

- Produces (`album-originals.server.ts`):
  - `ALBUM_ORIGINAL_PREFIX = "album-originals/"`
  - `ALBUM_FULL_PREFIX = "album-full/"`
  - `albumOriginalKey(photoId: string, hash: string, contentType: AcceptedImageContentType): string`, with extension `jpg`, `png` or `webp`
  - `albumFullKey(photoId: string, originalHash: string): string`
  - `parseAlbumOriginalKey(key: string): { photoId: string; hash: string; contentType: AcceptedImageContentType } | null`
  - `parseAlbumFullKey(key: string): { photoId: string; hash: string } | null`. Both parsers accept only `[0-9a-f]{16}` hashes and a uuid `photoId`.
  - `putAlbumOriginal(key: string, bytes: ArrayBuffer, contentType: AcceptedImageContentType): Promise<void>`
  - `putAlbumFull(key: string, bytes: ArrayBuffer, dims: { widthPx: number; heightPx: number }): Promise<void>`. Stores `customMetadata` `{ widthPx, heightPx }` as strings and `contentType: "image/webp"`.
  - `headAlbumPrivate(key: string): Promise<R2Object | null>`
  - `getAlbumPrivate(key: string): Promise<R2ObjectBody | null>`
  - `deleteAlbumPrivate(keys: readonly string[]): Promise<void>`. Best-effort: it swallows errors, like `deleteAlbumImage` callers do.

- [ ] **Step 1: Write the failing tests.**
  - Round trips: `parseAlbumOriginalKey(albumOriginalKey(id, h, "image/jpeg"))` gives `{ photoId: id, hash: h, contentType: "image/jpeg" }`, and likewise for png, webp and the full key.
  - Parsers return `null` for: another prefix, `../`, uppercase hex, a 15-character hash, a non-uuid ID, a `.gif` extension, and a full key ending `.jpg`.
  - `putAlbumFull` then `headAlbumPrivate` shows `contentType` `image/webp` and the `customMetadata`.
  - In `retention.test.ts`:
    - "sweeps an old unreferenced album original and full copy";
    - "keeps album keys a row references";
    - "keeps a young unreferenced original", which is age-guarded like the existing private-sweep cases.
  - In `album-actions.test.ts`: "deleting a photo removes its original and full copy". Seed a row with both keys and objects, then expect both heads to be `null` after `deleteAlbumPhotoAction`.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/server/r2/__tests__/album-originals.test.ts src/server/cron/__tests__/retention.test.ts src/features/album/server/__tests__/album-actions.test.ts`
- [ ] **Step 3: Implement.**
  - Add both prefixes to `sweepOrphanPrivateR2Keys` and update its doc comment.
  - `loadReferencedPrivateR2Keys` unions in `album_photos.original_key` and `full_key`, each `isNotNull`. These are two selects, not an `IN` list.
  - `deleteAlbumPhotoAction` calls `void deleteAlbumPrivate([originalKey, fullKey].filter(nonNull))` next to the existing `deleteAlbumImage`.
- [ ] **Step 4: Run again.** The same command should PASS.
- [ ] **Step 5: Commit.** `feat(ucmc-web): private storage and sweep for Album originals`

### Task 5: The Images binding and the clean-copy renderer

**Files:**

- Modify: `apps/ucmc-web/wrangler.jsonc` (add `"images": { "binding": "IMAGES" }` at the top level **and** in `env.production`, with a comment pointing at the spec's JPEG trap)
- Modify: `apps/ucmc-web/scripts/wrangler-env.ts`:
  - add `"images"` to `SECTION_KEYS`;
  - extend `Section` with `readonly images?: { binding: string }`;
  - make the env-repeat check cover it. `bindingNames` returns `[section.images.binding]` for the `images` key, and `"images"` joins `BINDING_KEYS`.
  - It is not per stack, so `syncWranglerConfig` writes nothing for it.
- Modify: `apps/ucmc-web/src/server/cloudflare-env.ts` (`IMAGES: ImagesBinding` on `WorkerEnv`, with the local-mode-doesn't-rotate note)
- Create: `apps/ucmc-web/src/server/images.ts`
- Create: `apps/ucmc-web/src/features/album/server/album-clean-copy.server.ts`
- Modify: `apps/ucmc-web/vitest.workers.config.ts` only if the pool doesn't pick the binding up from `wrangler.jsonc`. Check first.
- Test: `apps/ucmc-web/scripts/__tests__/wrangler-env.test.ts`, `apps/ucmc-web/src/features/album/server/__tests__/album-clean-copy.test.ts`

**Interfaces:**

- Produces:
  - `getImages(): ImagesBinding` in `#/server/images`
  - `renderCleanWebp(original: ArrayBuffer): Promise<{ bytes: ArrayBuffer; widthPx: number; heightPx: number }>`, which throws on any binding failure. Implementation:
    - `getImages().input(stream).output({ format: "image/webp", quality: 90 })`;
    - read the bytes from `.response().arrayBuffer()`;
    - get dimensions from `getImages().info(…)` on those bytes (`.info()` is free);
    - throw if `info.format !== "image/webp"`.

- [ ] **Step 1: Write the failing tests.**
  - `wrangler-env.test.ts`:
    - "accepts an images binding repeated in env.production";
    - "refuses an images binding missing from env.production", with an error naming `images`;
    - "leaves the images binding unchanged when syncing".
  - `album-clean-copy.test.ts`, with `vi.mock("#/server/images")` returning a fake:
    - "asks the binding for image/webp at quality 90", asserting the exact `output` argument;
    - "returns the bytes and the dimensions info reports";
    - "throws when info reports a non-WebP format";
    - "propagates a binding error".
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run scripts/__tests__/wrangler-env.test.ts src/features/album/server/__tests__/album-clean-copy.test.ts`
- [ ] **Step 3: Implement** to the Interfaces above. `renderCleanWebp` carries a comment on `format` that names the JPEG trap and links the spec section.
- [ ] **Step 4: Verify.**
  - The tests from Step 2 PASS.
  - The real `wrangler.jsonc` passes: a `wrangler-env.test.ts` case reads the committed file and runs `syncWranglerConfig` for `dev` and `prod` against the outputs fixture that file already uses. Add that case if one doesn't exist.
  - `pnpm --filter ucmc-web typecheck` passes.
- [ ] **Step 5: Commit.** `feat(ucmc-web): bind Cloudflare Images and render a metadata-free WebP`

### Task 6: `uploadAlbumOriginal`: action, server function and hook

**Files:**

- Create: `apps/ucmc-web/src/features/album/server/album-original-actions.server.ts`
- Modify: `apps/ucmc-web/src/features/album/server/album-fns.ts` (add `uploadAlbumOriginalFn`)
- Create: `apps/ucmc-web/src/features/album/api/use-upload-album-original.ts`
- Test: `apps/ucmc-web/src/features/album/server/__tests__/album-original-actions.test.ts`

**Interfaces:**

- Consumes: Task 1's `readExifCaptureDate`; Task 4's key helpers, `putAlbumOriginal`, `putAlbumFull` and `matchesImageMagic`; Task 5's `renderCleanWebp`.
- Produces:
  - `type UploadAlbumOriginalResult = { photoId: string; originalKey: string; fullKey: string | null; takenDate: string | null; originalBytes: number; fullWidthPx: number | null; fullHeightPx: number | null }`, exported from `album-fns.ts` as a type. The last three feed the edit dialog's "Original: …" line for a fresh upload (Task 10).
  - `uploadAlbumOriginalAction(form: FormData): Promise<UploadAlbumOriginalResult>`. Reads fields `file` (a `File`) and an optional `photoId` (string).
  - `uploadAlbumOriginalFn`: `createServerFn({ method: "POST" }).validator((data: unknown) => { if (!(data instanceof FormData)) { throw new Error("Expected FormData"); } return data; })`, with a one-line dynamic-import handler.
  - `useUploadAlbumOriginal()`: a `useMutation` whose `mutationFn` is `(input: { file: File; photoId?: string }) => uploadAlbumOriginalFn({ data: toFormData(input) })`. It has **no `onSuccess` invalidation**, and a comment says why: no row exists yet.

- [ ] **Step 1: Write the failing tests.** Use the existing `album-actions.test.ts` sign-in helpers, copied or extracted to a shared `__tests__/album-test-helpers.ts`. Mock `#/server/images` with a fake that returns a fixed tiny WebP and `{ format: "image/webp", width: 3024, height: 4032 }`.
  - "requires public_album:manage": a member gets `Forbidden`.
  - "is rate-limited per user": mock `checkUploadRateLimit` → `false`, and expect an error with a member-readable message.
  - "rejects a file over 12 MB".
  - "rejects HEIC bytes declared as JPEG and writes nothing": bytes `....ftypheic` declared `image/jpeg`. Expect the error, and `getPrivateBucket().list({ prefix: "album-" })` to be empty.
  - "rejects an unknown photoId on edit".
  - "stores the original and the full copy under one minted uuid": both keys parse back to the same `photoId`, `originalKey`'s content type matches the upload, and `fullKey`'s hash equals the original's hash.
  - "returns the EXIF date": with a JPEG containing `DateTimeOriginal "2024:09:14 15:42:07"`, `takenDate` is `"2024-09-14"`. Reuse the Task 1 builder by moving it to `src/server/r2/__tests__/exif-fixtures.ts`.
  - "keeps the original when the binding fails": the fake throws, so the result is `fullKey: null` and the original object exists.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/features/album/server/__tests__/album-original-actions.test.ts`
- [ ] **Step 3: Implement** the spec's "Server: `uploadAlbumOriginalAction`" steps 1–7, in order.
  - Call `checkUploadRateLimit(principal.userId)` straight after `requireAlbumManager()`.
  - Mint the ID with `uuidv7()`.
  - Hash the original with `shortContentHash` and use it for both keys.
  - Wrap `renderCleanWebp` + `putAlbumFull` in `try/catch` that `console.error`s and yields `fullKey: null`.
  - Throw an `Error` with a member-readable message on every rejection. The dialog shows it through `imageUploadErrorMessage`.
- [ ] **Step 4: Run again.** The same command should PASS.
- [ ] **Step 5: Commit.** `feat(ucmc-web): upload an Album photo's original before the crop is saved`

### Task 7: Create and update record the original

**Files:**

- Modify: `apps/ucmc-web/src/features/album/server/album-schemas.ts`
- Modify: `apps/ucmc-web/src/features/album/server/album-actions.server.ts` (`createAlbumPhotoAction`, `updateAlbumPhotoAction`, `AlbumPhotoSummary`, and the two row mappers)
- Modify: `apps/ucmc-web/src/features/album/server/album-repo.server.ts` (select the new columns)
- Test: `apps/ucmc-web/src/features/album/server/__tests__/album-actions.test.ts`

**Interfaces:**

- Consumes: Task 4's parsers and `headAlbumPrivate`; Task 6's `UploadAlbumOriginalResult` shape.
- Produces:
  - Both input schemas gain `original: z.object({ photoId: z.string().uuid(), originalKey: z.string().max(200), fullKey: z.string().max(200).nullable() }).optional()`.
  - `AlbumPhotoSummary` gains `fullHash: string | null`, `originalBytes: number | null`, `fullWidthPx: number | null` and `fullHeightPx: number | null`. `fullHash` is the hash parsed from `original_key`, or `null` when there is no original.
  - Create uses `input.original.photoId` as the row `id` when present.

- [ ] **Step 1: Write the failing tests.** Seed objects with Task 4's `put*` helpers.
  - "create records a verified original": the row's columns come from the R2 heads (bytes, content type, the full copy's `customMetadata` dims), not from the input, and `fullHash` is the original's hash.
  - "create rejects an original key for a different photoId".
  - "create rejects a key with no object behind it".
  - "create rejects a full key that doesn't match the original's photoId and hash".
  - "create without `original` still works and stores nulls".
  - "update with a new original swaps the keys and deletes the old private objects".
  - "update rejects an original whose photoId isn't the row being edited".
  - "a text-only update leaves the private keys untouched".
  - "cleans up new private keys when the UPDATE fails": force the failure the way the existing replacement test does. Afterwards the new keys' heads are `null`, and the row and old objects are unchanged.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/features/album/server/__tests__/album-actions.test.ts`
- [ ] **Step 3: Implement** a private `verifyOriginal(input.original, expectedPhotoId: string | null)` in `album-actions.server.ts`. It returns the seven column values or throws `"Uploaded original not found"`. Create passes `null` and then uses `original.photoId`. Update passes `existing.id`. Extend the existing orphan cleanup on a failed insert or update to cover the new private keys, using `deleteAlbumPrivate`.
- [ ] **Step 4: Run again.** The same command should PASS.
- [ ] **Step 5: Commit.** `feat(ucmc-web): record a verified original on Album create and update`

### Task 8: Dialog uploads on pick, shows progress, prefills the date

**Files:**

- Modify: `apps/ucmc-web/src/hooks/use-image-crop.ts` (add `sourceFile: File | null` to `UseImageCropResult`; set it in `onFileChosen` before normalizing, clear it in `reset`)
- Modify: `apps/ucmc-web/src/features/album/components/photo-form-dialog.tsx`
- Test: `apps/ucmc-web/src/features/album/components/__tests__/photo-form-dialog.test.tsx`

**Interfaces:**

- Consumes: Task 6's `useUploadAlbumOriginal`; Task 7's `original` input field; `seed.photo.id` for edit.
- Produces: `UseImageCropResult.sourceFile`, which is the picked `File` as-is. It is state, not a function, so the referential-stability contract holds.

- [ ] **Step 1: Write the failing tests.** Mock `#/features/album/api/use-upload-album-original` with a controllable deferred.
  - "starts uploading the picked file immediately": `mutateAsync` is called with `{ file }` for create, and `{ file, photoId: seed.photo.id }` for edit.
  - "disables Save until the upload resolves".
  - "shows the upload error and retries the same file".
  - "prefills an empty date with 'From the photo'".
  - "never overwrites a date the member typed".
  - "ignores a superseded upload's reply": pick A, pick B, resolve B, then resolve A. The submit payload's `original` is B's, and the date is B's.
  - "sends `original` with create": the payload has `photoId`, `originalKey` and `fullKey` from the upload result.
  - The existing three "without looping" tests still pass.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/features/album/components/__tests__/photo-form-dialog.test.tsx`
- [ ] **Step 3: Implement.**
  - A `useEffect` on `crop.sourceFile` bumps a `pickRef` counter and starts the upload. It applies the result only if the counter still matches.
  - State holds `{ status: "idle" | "uploading" | "done" | "error"; result: UploadAlbumOriginalResult | null; error: string | null }`.
  - Save is `disabled` while `status === "uploading"`. On create, `"error"` also blocks Save. On edit, a failed upload blocks Save only while a new file is picked.
  - The "From the photo" hint shows while `form.takenAt === result.takenDate`.
- [ ] **Step 4: Run again.** The same command should PASS.
- [ ] **Step 5: Commit.** `feat(ucmc-web): upload the original on pick and prefill the Album photo date`

### Task 9: The members-only full-size route, with self-repair

**Files:**

- Modify: `apps/ucmc-web/src/features/album/server/album-original-actions.server.ts` (add `getAlbumFullImageAction`)
- Modify: `apps/ucmc-web/src/features/album/server/album-permissions.server.ts` (add `canViewAlbumOriginal`)
- Create: `apps/ucmc-web/src/routes/api/album-full.$publicId.$file.ts`
- Modify: `apps/ucmc-web/src/features/album/lib/image-url.ts` (add `albumFullUrl`)
- Modify: `apps/ucmc-web/src/routeTree.gen.ts`, **generated** by `pnpm --filter ucmc-web build`. Never hand-edit it.
- Modify: `apps/ucmc-web/knip.config.ts` only if knip flags the route.
- Test: `apps/ucmc-web/src/features/album/server/__tests__/album-original-actions.test.ts`, `apps/ucmc-web/src/features/album/lib/__tests__/album-image-key.test.ts`

**Interfaces:**

- Produces:
  - `canViewAlbumOriginal(principal: Principal): boolean`. Uses `effectivePermissions(principal, readViewAsCookie(), [])`, as `getSiteFeedbackScreenshotAction` does.
  - `getAlbumFullImageAction(publicId: string, file: string): Promise<{ body: ReadableStream; bytes: number } | null>`. `file` must equal `` `${fullHash}.webp` ``.
  - `albumFullUrl(publicId: string, fullHash: string, opts?: { download?: boolean }): string`, which returns `/api/album-full/<publicId>/<fullHash>.webp`, plus `?download=1` when `download` is set.
  - Route `GET` headers per the spec's "Route" section. The disposition filename is `ucmc-<publicId>.webp`.

- [ ] **Step 1: Write the failing tests.**
  - "returns null for each refusal": signed out, a member without the permission (remove the `role_member` grant in-test), unknown `publicId`, a legacy row, and a stale `file`. Assert all five return `null`.
  - "serves the stored full copy to a member".
  - "self-repairs a missing full copy": a row with `original_key` and `full_key` null, plus the fake binding. Afterwards the body is returned, the row has `full_key` and dims, and the object exists.
  - "a lost self-repair race doesn't error": pre-set `full_key` between read and write by stubbing the repo. The guarded `UPDATE … WHERE full_key IS NULL` affects 0 rows and the action still serves.
  - "returns null when self-repair fails".
  - `albumFullUrl` with and without `download`.
  - Route headers (`200`, the `404` response, and the `?download=1` disposition) are asserted by calling the route's `GET` handler directly, in the same test file.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/features/album/server/__tests__/album-original-actions.test.ts src/features/album/lib/__tests__/album-image-key.test.ts`
- [ ] **Step 3: Implement.** The route shape follows `site-feedback.$id.screenshot.ts`. Self-repair reuses `renderCleanWebp` + `putAlbumFull` with `albumFullKey(id, fullHash)`.
- [ ] **Step 4: Verify.** The tests from Step 2 PASS. After `pnpm --filter ucmc-web build`, `git diff --stat src/routeTree.gen.ts` shows the new route, and `pnpm --filter ucmc-web knip` is clean.
- [ ] **Step 5: Commit.** `feat(ucmc-web): serve the full-size Album photo to members`, including `routeTree.gen.ts`.

### Task 10: Lightbox "Show original" and "Download"; the edit-dialog original line

**Files:**

- Modify: `apps/ucmc-web/src/features/album/components/photo-lightbox.tsx`
- Modify: `apps/ucmc-web/src/features/album/components/photo-form-dialog.tsx` (the original line)
- Test: `apps/ucmc-web/src/features/album/components/__tests__/photo-lightbox.test.tsx`, `apps/ucmc-web/src/features/album/components/__tests__/photo-form-dialog.test.tsx`

**Interfaces:**

- Consumes: Task 7's `AlbumPhotoSummary.fullHash`, `originalBytes`, `fullWidthPx` and `fullHeightPx`; Task 9's `albumFullUrl`; `useAuth().hasPermission`.

- [ ] **Step 1: Write the failing tests.** Mock `#/features/auth/api/use-auth`.
  - "shows Show original and Download to a viewer with the permission".
  - "hides the controls when hasPermission says no, whatever principal.permissions holds": the mock's `principal.permissions` includes `public_album:view_original` but `hasPermission` returns `false`.
  - "hides the controls for a photo with no fullHash".
  - "keeps the crop on screen until the full image loads, then swaps": fire `load` on the full `<img>`.
  - "Download links to `albumFullUrl(…, { download: true })`".
  - "navigating to the next photo returns to the crop".
  - Dialog:
    - "shows 'Original: 3024 × 4032 · 3.1 MB' for a photo with an original";
    - "'No original stored' for a legacy photo";
    - "shows the line from the upload result after a fresh pick". It reads `UploadAlbumOriginalResult.fullWidthPx`, `fullHeightPx` and `originalBytes`, and shows no dimensions when `fullWidthPx` is `null`.
- [ ] **Step 2: Run and confirm they fail.** `pnpm --filter ucmc-web exec vitest run src/features/album/components`
- [ ] **Step 3: Implement.**
  - The lightbox calls `useAuth()` itself, rather than taking a prop, so the gate can't be bypassed by a caller.
  - Toggle state resets on `activePublicId` change.
  - Size formatting reuses an existing byte formatter if `src/lib` has one; check before writing one.
- [ ] **Step 4: Run again.** The same command should PASS.
- [ ] **Step 5: Commit.** `feat(ucmc-web): Show original and Download in the Album lightbox`

### Task 11: Rules, docs, verification and the PR

**Files:**

- Create: `.claude/rules/feature-album.md` (`paths: apps/ucmc-web/src/features/album/**`), carrying the six facts listed in the spec's "Rules and docs to update with the code"
- Modify: `.claude/rules/data/r2.md` (the two private prefixes and the private sweep)
- Modify: `README.md` and `CLAUDE.md` **only if** either lists Worker bindings. `grep -n "BUCKET_PRIVATE\|bindings" README.md apps/ucmc-web/README.md CLAUDE.md` to decide.

- [ ] **Step 1: Write the rules and doc changes.**
- [ ] **Step 2: Run full verification.** `pnpm verify` should show lint, typecheck, knip, db:drift and tests all passing. Quote the summary line in the PR.
- [ ] **Step 3: Read `/privacy`.** Check `src/config/legal.ts` for text covering stored photo metadata. Draft wording for legal review only if it's missing. **Do not edit `legal.ts`.**
- [ ] **Step 4: Commit.** `docs(ucmc-web): album rules for originals and the full-size view`
- [ ] **Step 5: Run the review.** Run the `pr-preflight` agent and `/code-review --fix`, judge each finding, then re-run `pnpm verify`.
- [ ] **Step 6: Open the PR** once the owner says to push. The body includes:
  - the summary;
  - the `pnpm verify` result;
  - the privacy draft, or "existing text covers it" with the quote;
  - an unchecked **dev-stack manual check** list, copied from the spec's "Manual check on the dev stack" with its three steps;
  - "prod waits on the manual check".
- [ ] **Step 7: After the merge, with the owner's okay:**
  - Post the #214 and #191 comments described in the spec's "After the PR".
  - Add the compliance-wiki entry from the spec's "Privacy and compliance": what is stored, where, who can read it, how long, and how it is deleted. The wiki isn't checked out here. Clone it to the scratchpad and commit as the owner.
