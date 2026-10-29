/**
 * Bearer tokens that D1 only ever sees hashed: magic links, session
 * cookies and calendar feed URLs (#379). The holder gets 32 random
 * bytes, base64url-encoded; the row stores their SHA-256, so a leaked
 * backup, export or Time Travel restore holds no usable token.
 *
 * No salt or key stretching: the input is 256 bits of randomness, not a
 * password, so there is nothing to brute-force.
 */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url(new Uint8Array(digest));
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
