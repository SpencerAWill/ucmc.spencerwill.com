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
 */
export function sanitizeFilenameSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}
