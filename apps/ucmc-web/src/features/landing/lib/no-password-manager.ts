/**
 * Opt-out attributes for the major password managers and form-fillers.
 * Spread onto every Input/Textarea in landing-content editors — none of
 * those fields are credentials, addresses, or identity data, so the
 * inline-fill menus get in the way (most visibly, 1Password's typeahead
 * eats the first keystroke when it offers a suggestion).
 *
 * - `data-1p-ignore`            — 1Password
 * - `data-lpignore="true"`      — LastPass
 * - `data-form-type="other"`    — Dashlane heuristic
 *
 * Browser-native autofill is suppressed via `autoComplete="off"`.
 */
export const noPasswordManagerProps = {
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-form-type": "other",
  autoComplete: "off",
} as const;
