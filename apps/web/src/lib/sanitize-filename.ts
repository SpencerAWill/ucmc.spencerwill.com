/**
 * Whitelists the characters allowed in a filename segment that's
 * being interpolated into a `Content-Disposition` response header.
 * Defends against header injection if the source string ever turns
 * out to contain `;`, CR/LF, `=`, `"`, or other separators —
 * treating the input as untrusted at the header boundary is the
 * right discipline even when upstream validation should have caught
 * it.
 *
 * Replaces every non-allowed character with `_`. Allowed:
 * `A-Z a-z 0-9 . _ -`.
 *
 * NOTE: `.` is in the whitelist, so `..` round-trips unchanged
 * (`../../etc/passwd` becomes `.._.._etc_passwd`, not `___etc_passwd`).
 * That's safe in a `Content-Disposition` header — `..` is inert there
 * — but it's NOT safe if the result is used to construct a filesystem
 * path. Do NOT reuse this helper for filesystem path construction;
 * scope it to header / similar contexts where dots are inert.
 */
export function sanitizeFilenameSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}
