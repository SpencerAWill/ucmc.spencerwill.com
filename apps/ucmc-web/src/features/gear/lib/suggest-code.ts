/**
 * Pure helper that mirrors the server's `suggestCodeForTypeAction` for
 * client-side preview UIs. Given a type's prefix and a list of existing
 * active codes (any type), returns the lowest unused integer suffix
 * appended to the prefix.
 *
 * Non-numeric tails and codes that don't match the prefix are ignored.
 * Returns "" if the type has no prefix configured.
 */
export function suggestCode(prefix: string | null, codes: string[]): string {
  const trimmedPrefix = (prefix ?? "").trim();
  if (trimmedPrefix.length === 0) return "";
  let max = 0;
  let found = false;
  for (const code of codes) {
    if (!code.startsWith(trimmedPrefix)) continue;
    const tail = code.slice(trimmedPrefix.length);
    if (!/^\d+$/.test(tail)) continue;
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n)) {
      found = true;
      if (n > max) max = n;
    }
  }
  return `${trimmedPrefix}${found ? max + 1 : 1}`;
}
