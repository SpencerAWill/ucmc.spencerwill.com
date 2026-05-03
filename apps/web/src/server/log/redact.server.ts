/**
 * Redaction utilities for server-side logging.
 *
 * Workers Logs (`wrangler.jsonc` `observability.enabled = true` with
 * `head_sampling_rate: 1`) captures every invocation, retains for ~7
 * days, and is visible to anyone with Cloudflare dashboard access on
 * the account. That makes the audit log's PII discipline — non-PII
 * context only — extend to `console.*` calls too: any structured log
 * line that touches user data should run through these helpers
 * before it goes out.
 *
 * Conventions:
 *   - Use `redactEmail` for any field holding an email address. Local
 *     part is masked to first character + asterisks, domain
 *     preserved so an operator can still distinguish "external user"
 *     from "uc.edu user" without learning who the user is.
 *   - Use `redactUrl` for outbound URLs that may carry auth tokens
 *     (magic-link URLs in particular). Path is preserved; query +
 *     fragment are dropped because magic-link tokens live in the
 *     query string.
 *   - Use `redactString` when the input is freeform text that may
 *     embed either of the above (email-shaped tokens, URLs).
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_PATTERN = /https?:\/\/[^\s]+/g;

/**
 * Mask the local part of an email. `alice@example.com` →
 * `a***@example.com`. Preserves the domain so an operator reading
 * logs can distinguish populations of users without learning
 * identities. Empty / malformed input returns a safe placeholder
 * rather than echoing the raw value.
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) {
    return "<empty>";
  }
  const at = email.indexOf("@");
  if (at <= 0) {
    return "<malformed>";
  }
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 1) {
    return `*${domain}`;
  }
  return `${local[0]}***${domain}`;
}

/**
 * Strip query + fragment from a URL. `https://app/auth/callback?token=abc`
 * → `https://app/auth/callback`. Preserves scheme + host + path so
 * "which endpoint" is recoverable from logs without leaking the
 * token. Non-URL input returns a placeholder.
 */
export function redactUrl(url: string | null | undefined): string {
  if (!url) {
    return "<empty>";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<malformed>";
  }
}

/**
 * Replace email- and URL-shaped substrings inside a freeform string.
 * Use for log lines that include officer-typed text or otherwise
 * unstructured content (error messages from external APIs, for
 * instance) where the redaction can't be applied at the field
 * level. Conservative — only strips matches; doesn't try to detect
 * other PII shapes (phone numbers, names) which it can't reliably
 * recognize anyway.
 */
export function redactString(text: string): string {
  return text
    .replace(URL_PATTERN, "<url-redacted>")
    .replace(EMAIL_PATTERN, "<email-redacted>");
}
