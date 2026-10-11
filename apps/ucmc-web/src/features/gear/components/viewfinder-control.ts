/**
 * The look of every control floated over the viewfinder: light-on-dark,
 * because it sits on a black box in either theme, and a filled white
 * chip when pressed. Shared by the desk's overlay toggles and the camera switcher
 * `BarcodeScanner` renders itself, so they can't drift. Its own module
 * rather than an export of `barcode-scanner.tsx`, which tests mock
 * wholesale.
 *
 * Pressed state keys on `aria-pressed`, not `data-state=on`: a
 * `TooltipTrigger` wrapping a toggle stamps its own `data-state`
 * ("closed", "delayed-open") over the toggle's, so the usual selector
 * never matched and on looked exactly like off.
 */
export const VIEWFINDER_CONTROL_CLASS =
  "inline-flex size-8 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors outline-none hover:bg-black/70 hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/60 aria-pressed:bg-white aria-pressed:text-black aria-pressed:hover:bg-white/90 [&_svg]:size-4";
