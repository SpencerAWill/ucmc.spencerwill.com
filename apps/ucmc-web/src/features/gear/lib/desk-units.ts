/**
 * How many physical pieces one desk row or result stands for: 1 for a
 * coded piece, its quantity for a counted one.
 *
 * Both panes count in units — "Check out 7 items" for a harness and six
 * draws — and so do their confirmations. One definition, so the button
 * and the toast in either pane can't disagree about what was handed
 * over.
 */
export function deskUnits(
  row: { kind: "coded" } | { kind: "counted"; quantity: number },
): number {
  return row.kind === "coded" ? 1 : row.quantity;
}

/** `deskUnits` summed over a batch. */
export function sumDeskUnits(
  rows: ReadonlyArray<
    { kind: "coded" } | { kind: "counted"; quantity: number }
  >,
): number {
  return rows.reduce((sum, row) => sum + deskUnits(row), 0);
}
