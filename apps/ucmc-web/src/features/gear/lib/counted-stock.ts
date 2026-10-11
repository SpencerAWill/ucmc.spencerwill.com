/** The three terms of a counted model's availability. */
export interface CountedStockTerms {
  /** Units in the serviceable stock bucket — every one the club owns
   *  in that condition, the ones out with members included. */
  serviceable: number;
  /** Units outstanding on open loans (`quantity - quantity_returned`). */
  onLoan: number;
  /** Units under live holds. */
  held: number;
}

/**
 * What the desk can hand out of a counted model: serviceable stock,
 * less what is out, less what is held — floored at zero.
 *
 * **The one TypeScript definition**, read by browse-by-model, the
 * models dialog, the desk lookups and the checkout refusal message. The
 * authoritative check is the SQL copy in `insertCountedLoanIfAvailable`,
 * which has to run inside the insert's own statement and so can't call
 * this; if the two drift, the desk offers units the guard refuses.
 *
 * `respectHolds: false` is an officer's `overrideHolds`: held units
 * stop counting against the request, the shelf and the loans still do.
 */
export function countedTakeable(
  terms: CountedStockTerms,
  { respectHolds = true }: { respectHolds?: boolean } = {},
): number {
  return Math.max(
    0,
    terms.serviceable - terms.onLoan - (respectHolds ? terms.held : 0),
  );
}
