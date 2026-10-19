/**
 * The longest return path we round-trip. It rides in a query string,
 * then in an emailed URL, so it has to stay well inside what mail
 * clients and proxies keep intact.
 */
export const MAX_RETURN_PATH_LENGTH = 2048;

/**
 * Validates a post-sign-in return path (`?redirect=`), returning it
 * unchanged when it is a same-origin, root-relative path and `null`
 * otherwise. Every place that reads or forwards the value calls this —
 * the sign-in page, the magic-link server fn and email builder, the
 * callback, and both passkey paths — so the rule can't drift between
 * copies.
 *
 * A bare `startsWith("/")` is not enough. A URL parser resolves:
 *
 *   - `//evil.example`  as protocol-relative — a different host;
 *   - `/\evil.example`  the same way, because WHATWG URL treats `\` as
 *     `/` for http(s);
 *   - `/\t/evil.example` as `//evil.example`, because it strips tab, CR
 *     and LF from anywhere in the input before parsing.
 *
 * So a value must start with exactly one `/` that isn't followed by
 * another `/` or `\`, and contain no control characters at all. A scheme
 * (`javascript:`, `https:`) can't appear before the leading `/`, which
 * matters because `navigate({ href })` does a full document navigation
 * for any href with a scheme.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length > MAX_RETURN_PATH_LENGTH) {
    return null;
  }
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") {
    return null;
  }
  if (/\p{Cc}/u.test(value)) {
    return null;
  }
  return value;
}
