interface OriginalFacts {
  originalBytes: number | null;
  fullWidthPx: number | null;
  fullHeightPx: number | null;
}

/**
 * The edit dialog's "Original: 3024 × 4032 · 3.1 MB" line. The
 * dimensions can be missing while the full copy awaits self-repair,
 * in which case only the size is shown. `null` means there is no
 * original to describe.
 */
export function originalLabel(facts: OriginalFacts): string | null {
  if (facts.originalBytes === null) {
    return null;
  }
  const size =
    facts.originalBytes < 1024 * 1024
      ? `${Math.round(facts.originalBytes / 1024)} KB`
      : `${(facts.originalBytes / (1024 * 1024)).toFixed(1)} MB`;
  if (facts.fullWidthPx === null || facts.fullHeightPx === null) {
    return `Original: ${size}`;
  }
  return `Original: ${facts.fullWidthPx} × ${facts.fullHeightPx} · ${size}`;
}
