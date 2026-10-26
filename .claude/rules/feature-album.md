---
paths:
  - "apps/ucmc-web/src/features/album/**"
  - "apps/ucmc-web/src/routes/api/album-full.$publicId.$file.ts"
---

# Album originals and the full-size view

A manager's upload keeps the raw file privately (`album-originals/`) and a metadata-free copy (`album-full/`). Members with `public_album:view_original` see the copy via `/api/album-full/$publicId/$file`. Prefixes and the sweep: `data/r2.md`.

## Easy to break

- **The clean copy is WebP only.** The Images binding keeps GPS, `DateTimeOriginal` and `Make` when it outputs JPEG; only WebP drops them. Encode with `output({ format: "image/webp", quality: 90 })`, never JPEG, never "to keep the format".
- **The clean copy is checked, not trusted.** That WebP drops metadata was only probed with JPEG input, so `renderCleanWebp` walks the output's RIFF chunks (bounded) and throws on an `EXIF` or `XMP ` chunk, or on output it can't walk. A throw stores `full_key = null`, and self-repair's throw is the route's `404`: failing closed costs a member the full-size view, never a location.
- **A failed save spends its keys.** Create and update delete the private objects they were sent when the write fails, so the dialog uploads the same file again for fresh keys (Save stays disabled meanwhile) rather than resending the deleted ones. **That delete is awaited before the error returns**: an edit's re-upload writes the very same keys (photo id + file hash), so a fire-and-forget delete could land after it and remove the fresh upload. Create skips the delete when a row already holds the id, since a double-submitted Save can lose the PK race after passing the pre-insert check.
- **The photo ID is minted at upload**, before the row exists, so the keys can name it. Create takes that ID and refuses one already owned by a row (a failed insert would otherwise delete a live row's keys). Keys the old and new row share are never deleted.
- **The full key reuses the original's hash** (`albumFullKey(id, hash)`), so a URL exists before `full_key` is filled. The route trusts `row.fullKey` only when it equals `albumFullKey(id, hash)`. Self-repair's guarded `UPDATE` matches `original_key` as well as `full_key IS NULL`, so it loses a race or an image swap without error.
- **Every refusal on the full-size route is the same `404` with `Cache-Control: private, no-store`**: signed out, no permission, unknown or legacy photo, stale hash, failed repair. A distinct response tells a scraper which photos have originals.
- **`taken_at` is a calendar date stored as UTC midnight**, including the EXIF-prefilled one. Do not move it to `CLUB_TIME_ZONE`; every reader uses UTC.
- **Local mode does not apply EXIF orientation.** `wrangler dev` and the vitest pool run the binding through `sharp`, which ignores `Orientation` and `quality`. A sideways phone photo's clean copy is sideways locally and upright in production, so rotation and stripping are only provable on the dev stack.
- **Member-facing upload errors are an allow-list** in `lib/upload-messages.ts`. Any other text shows one generic line, because the server-fn transport rethrows whatever the response carried. The server wraps storage failures into those messages; add a new message there, not a raw `throw`.
- **The upload is a `FormData` server function**, not JSON: the file travels as a binary body, and the transport's CSRF check expects it.
