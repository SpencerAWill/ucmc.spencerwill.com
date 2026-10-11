/**
 * Prefix that marks a counted model's **bin label** at the gear desk.
 * The label encodes `${MODEL_LABEL_PREFIX}${model.publicId}`.
 *
 * Counted stock has no unit to label — the desk hands out six draws and
 * counts six back — so the label goes on the bin and names the model.
 * Per model rather than per physical bin: a model split across two bins
 * wants two copies of one label, which this gives for free, where a bin
 * entity would be a new table for no new question answered (#223).
 *
 * It needs a prefix of its own. A bare publicId would be ambiguous
 * against a short code — both are freeform lowercase-alphanumeric — and
 * a third bare-string shape would turn the discriminator into
 * guesswork. Like `CART_TOKEN_PREFIX`, the desk never tests it inline:
 * `parseScanPayload` is the one place that decides.
 */
export const MODEL_LABEL_PREFIX = "ucmc-model:";

/** What a bin label for this model encodes. The only way a label's
 *  payload is built, so the printer and the parser can't drift. */
export function modelLabelPayload(modelPublicId: string): string {
  return `${MODEL_LABEL_PREFIX}${modelPublicId}`;
}
