---
paths:
  - "apps/ucmc-web/src/features/gear/**/*desk*"
  - "apps/ucmc-web/src/features/gear/**/*scan*"
  - "apps/ucmc-web/src/features/gear/**/*wedge*"
  - "apps/ucmc-web/src/features/gear/**/*barcode*"
  - "apps/ucmc-web/src/features/gear/**/*label*"
  - "apps/ucmc-web/src/features/gear/components/viewfinder-control.ts"
  - "apps/ucmc-web/src/features/gear/components/gear-code-search-combobox.tsx"
  - "apps/ucmc-web/scripts/sync-zxing-wasm.ts"
  - "apps/ucmc-web/src/server/headers.server.ts"
  - "apps/ucmc-web/e2e/gear-scanner.spec.ts"
---

# The gear desk: scanning, wedge scanners, and labels

Part of the gear rule; `gear/loans.md` covers what checkout and check-in decide.

The **gear-desk Sheet** hosts checkout and check-in behind a compact Check out / Check in tab switch **on the header row beside the title** — it was a full-width tab bar of its own, a whole row for two words on the screen where vertical space matters most. The row reserves `pr-8` for the Sheet's absolutely-positioned close button and wraps the switch under the title rather than colliding, though it fits on one line down to 360px. An earlier mobile FAB iteration was dropped because the FAB's fixed positioning fought the sidebar's stacking context.

### Two ways a code reaches the desk, one discriminator

**`parseScanPayload` (`lib/scan-payload.ts`) is the only place that decides what a scanned string is.** `handleScan` used to branch inline — `ucmc-cart:` prefix → resolve a cart, anything else → treat it as a short code — which was fine while the camera was the only producer. #224 finding 5 called it out; #215 made it real by adding a second producer.

**The payload namespace, all of it:**

| Payload                      | Kind    | Printed by                       | Desk does                                                  |
| ---------------------------- | ------- | -------------------------------- | ---------------------------------------------------------- |
| `ucmc-cart:<uuid>`           | `cart`  | the member's cart QR (5 min TTL) | checkout: resolve the snapshot; check-in: refuse, say why  |
| `ucmc-model:<modelPublicId>` | `model` | a counted model's **bin label**  | checkout: add the model at qty 1; check-in: find its loans |
| anything else                | `code`  | an item label                    | exact `getItemByCode`                                      |

**Bin labels (#223) need a prefix of their own.** A bare publicId would be ambiguous against a short code — both are freeform lowercase alphanumerics — and a third bare-string shape would make the discriminator guesswork. `MODEL_LABEL_PREFIX` and `modelLabelPayload()` live in `lib/model-label.ts` so the printer and the parser build the string the same way, and the desk never tests the prefix inline. A prefix with nothing usable after it parses to `null` (a mangled label), not to a code.

- **Per model, not per physical bin.** A model split across two bins wants two copies of one label, which the print pane's "Copies" field gives for free; a bin entity would be a new table for no new question answered.
- **Always CODE128, on a wider card** (`ModelBinLabelPane`, the barcode button on a counted model's row in the models dialog). The payload is lowercase with a `:`, which CODE39 can't encode, and ~23 characters needs ~3.5″ at a bar width a phone camera resolves. A QR would shut out 1D lasers. The pane reuses `LabelPrintArea` — the print stylesheet lives once, in `gear-label-sheet.tsx`.
- **A bin scan does not move focus into the new quantity field.** The wedge treats a focused number field as text it must not capture into, so the _next_ scan from a gun without an AIM prefix would type `CH93` into the quantity and set it to 93. A pick from the combobox does focus it, because the officer is typing there already.
- **At check-in a bin names a model, and a return lands on a loan.** One open loan of it: added. Several: a "Whose are these?" chooser. A model flipped back to coded after its label went on the bin says so, rather than "not found".

It also strips an **AIM symbology identifier** (ISO/IEC 15424) — `]` + symbology char + modifier — which a reader prepends when "Transmit Code ID Character" is set to AIM. **Our labels transmit `]C0`, plain CODE128; `]C1` is GS1-128, which we never emit**, so the parser matches the identifier's _shape_. A discriminator hardcoded to the `]C1` most documentation leads with would have failed on every real scan.

**The symbology is carried through rather than discarded, as a hint and never a gate.** A 2D imager pointed at a harness reads the manufacturer's own DataMatrix — Petzl marks PPE with one carrying the individual serial number — and `]d*` is a symbology we never print, so the pane can say "that's the manufacturer's tag" instead of "no gear matches code 3F8A91C2". It cannot be a gate: a cart QR could be printed on paper, so refusing a payload for arriving in an unexpected symbology would reject real scans to enforce an assumption nobody made.

`isCartToken()` is gone. knip caught it losing its last call site, which is what knip is kept green for — a second, weaker discriminator beside the real one is the drift.

### Counted rows at the desk

**No separate counted pane: a counted row sits in the same table as the coded ones.** The batch the desk actually sees is "a harness and six draws", and two panes would have made it two submits, two standing checks and two override passes. #223 weighed a separate tab and a split sub-section and took the mixed list.

- **The combobox gains a second group, from a second query** — `searchCountedModelsForDesk` at checkout, `listOpenCountedLoans` at check-in. Widening `searchItemsByCode` into a union instead would have changed what a typed `CH9` matches; coded results stay first, so a code + Enter adds the piece it always did. At check-in the counted group searches **loans**, by model _or borrower_ — a return has to land on somebody's loan, and "Riley" is how the officer thinks of it.
- **A counted row puts its quantity where the code would be** and names the model on a second `<tr>` spanning the columns, the same shape as the error line. **Coded rows carry the same `SubjectLine`** (product · type), so the officer can tell the Corax from the Sitta without hovering for the row's `title` — the two kinds read alike, with availability only on counted rows. A wider first cell would have broken the column grid at phone width, which is where this Sheet is most often used. The header reads **"Gear"**, not "Code", for that reason. **That line must carry `whitespace-normal`** — shadcn's `TableCell` is `nowrap`, and an unwrapped model name widened the table past the Sheet, pushing the remove button off-screen on desktop as well as on a phone. The same goes for the bin-label card's `min-w-0`: a grid item's minimum is its min-content width, which for a barcode is the SVG's intrinsic pixel width.
- **Asking for more than `takeable` is advised against, never blocked.** A `gear:manage` officer may override into held units, and the server is the authority on the shelf. Check-in caps the field at what's still out, because there the server refuses more and no override exists.
- **The button and the item count are in units** ("Check out 7 items" for a harness and six draws); a row count would undercount what is in the member's hands. A short return's toast says how many are **still out**, so "checked in" never reads as "closed".
- `DeskQuantityInput` keeps a text draft so the officer can clear the box to type "12", and stays `text-base` below `md` — anything smaller and iOS zooms the page on focus.

### USB keyboard-wedge scanners

Cheap USB scanners are HID keyboard wedges: they "type" the payload then a terminator. No permission, no camera, far faster for a batch of returns. **The browser cannot tell one from a keyboard** — a `keydown` carries no device identity — so recognition is a heuristic, and `lib/wedge-buffer.ts` is all of it, as a pure reducer with the clock as a parameter.

Calibrated against `onscan.js`, the closest prior art. **Its `minLength: 6` is the one default we cannot take** — `LJ4` is a real code — and that, plus an untyped vanilla-JS dependency against a `minimumReleaseAge`-quarantined supply chain, is why this is ~100 lines rather than a dep.

**Two tiers, because they fail in opposite directions.**

- **Tier 1 — the burst announces itself.** An opener identifies it from the first keystroke, so it can be captured **inside a focused text field**. Two openers: `]` (the AIM flag — the standard way, and the preferred config) and `WEDGE_SENTINEL` (`~`, a plain configured preamble, for the budget readers that cannot emit an AIM ID at all).
- **Tier 2 — timing alone.** Machine speed across every gap (`maxInterKeyMs` 50) plus a terminator. Bails out inside focused text fields, because it is only a _guess_ that a machine is typing. **This tier is why the feature works out of the box** — without it the replacement gun somebody plugs in next season fails _silently_, which in a volunteer-run cave is the worst available outcome.

Four things that are the way they are on purpose:

- **`~` is swallowed on sight; `]` is not.** The sentinel is ours and nobody types a tilde, so capturing it leaks nothing. `]` is a character an officer might really write ("replaced buckle [2024]"), so it opens a tier-1 burst but the keystroke itself passes through and is buffered — capture starts at the next key. The worst case is one stray `]`, not an unTypeable character.
- **The reducer never strips an AIM identifier.** It strips only `WEDGE_SENTINEL`, its own invention. `parseScanPayload` owns the rest, which is what stops the two files disagreeing about whether `]99CH93` is an identifier (it isn't) or part of a code (it is).
- **A late key starts a NEW buffer rather than poisoning the current one.** Discarding instead lets one stray keystroke eat the scan that follows.
- **`preventDefault` on a terminator that completes a scan is load-bearing, not tidiness.** The desk has a live "Check out N items" button and Radix focuses something when the Sheet opens, so an uncaptured Enter submits the batch mid-scan; a Tab terminator moves focus. The inverse matters equally — a terminator that completes nothing must fall through, or the submit button becomes unreachable by keyboard.

**The listener is on `document` in the capture phase, so focus is irrelevant.** That is the answer to #215's rejected "always-focused hidden input": not competing for focus beats winning. Capture phase specifically, because `cmdk` and Radix handle Enter and Tab on their own elements. **The jsdom suite cannot see that choice** — the combobox is stubbed there, so bubble-phase passes every component test; `e2e/gear-scanner.spec.ts` is what covers it.

**`data-wedge-capture` opts an input out of the text-field protection**, and `GearCodeSearchCombobox` wears it. That input is _already_ an accidental wedge target — its own doc comment describes typing a code and pressing Enter — but it resolves by prefix search and first match while `handleScan` resolves exactly. Without the attribute, one trigger pull means two different things depending on where focus sat.

**The wedge defaults ON (`ucmc:gear-scanner:wedge`), the camera defaults OFF.** A camera that starts itself fires a permission prompt the moment the Sheet opens; a wedge that is simply not plugged in costs nothing.

**`DeskScanControls` owns the Scan column** — camera, wedge, and **one** confirmation line for both. Both panes rendered that column verbatim before; #223 was going to add a third copy as a separate counted pane, and doesn't, because counted rows live in the two existing panes (below). The camera scanner's in-viewfinder "Scanned CH93" pill moved there: two confirmations for one officer action drift in wording and timing, and the wedge has no viewfinder to overlay one on.

**The viewfinder carries its controls as icon toggles with tooltips, not a row of labelled switches.** Top-left, stacked: **Camera**, **Scan sound**, then two that appear only with the camera on — **Flashlight** (only when the running track reports a `torch` capability: Android Chrome yes, iOS Safari and most webcams no; off on every start, because a light left on is a flat battery) and **Switch camera** (only with more than one camera; last so nothing shifts when it appears). A live preview also carries an **aiming frame** — corner brackets shaped for our wide CODE128 strips, `pointer-events-none`, guidance rather than a crop (the detector reads the whole frame). The preview behind every overlay can be anything from a dark bin to a white label, so the chips carry a shadow and outline and the brackets a drop-shadow; a white pressed chip on a bright frame otherwise loses its edge. Top-right: **Handheld scanner**, with a dot badge for its state (grey = ready, green = a burst has arrived). The names are for what the officer holds: "Scanner" vs "USB scanner" both described a scanner, and a Bluetooth gun in keyboard mode takes the handheld path too.

- **They render beside the "tap to start the camera" button, never inside it**, so a click on one doesn't also start the camera. `BarcodeScanner` is controlled (`enabled` / `onEnabledChange`) and takes `overlayLeft` / `overlayRight`; it renders the camera switcher itself because the device list is its state.
- **Pressed styling keys on `aria-pressed`, not `data-state=on`.** A `TooltipTrigger` wrapping a toggle stamps its own `data-state` over the toggle's, so the usual selector never matched and on looked exactly like off. `VIEWFINDER_CONTROL_CLASS` lives in its own module (`viewfinder-control.ts`) because tests mock `barcode-scanner.tsx` wholesale.
- **A tooltip never opens on touch**, so the handheld's readiness is also its `aria-describedby` — and that is what `e2e/gear-scanner.spec.ts` asserts, not visible text.
- **Scan sound is camera-only, off by default, synthesised with Web Audio** (`hooks/use-scan-beep.ts`) — `barcode-detector` has no audio. A handheld gun beeps itself, and two tones per trigger pull is noise. It plays only for a payload that parses, the same rule as the green confirmation line, and the toggle's click is the gesture that unlocks the `AudioContext` under autoplay rules.

**One label in view is one scan.** The detector reports a label on every frame, so the camera loop fires a code once and not again until it has been **out of view** for 1.5 s — the window slides, refreshed on every sighting. It used to be measured from the last fire, so a label held still re-fired every 1.5 s: a fresh "can't be checked out" toast each time, and for a cart QR a fresh resolve and `loan.cart_scanned` audit row. The handheld path never had this — a gun sends one burst per trigger pull.

**Scanner config, for whoever buys the gun** (all set by scanning setup barcodes from its manual): "Transmit Code ID Character" = **AIM** (defaults to None; if the reader has no AIM option, set the prefix/preamble to `~` instead) · terminator = **Enter** (Tab also works) · keyboard layout = **US**, the one that actually bites, since a mismatch on a shared cave laptop produces silently mangled codes rather than an error · and **leave it in keyboard-wedge mode**. Do not flip it to HID POS: that is the better protocol (decoded data plus symbology in one report, reachable via WebHID) but it takes the gun _out_ of keyboard mode, so it stops working in every other application on that laptop. A **2D imager** reads our CODE128 labels _and_ a member's cart QR off their phone; a 1D laser reads the labels only.

### Barcode scanning is hand-rolled

Native `BarcodeDetector` on Chrome / Edge / Android Chrome (zero deps, zero WASM), with a `barcode-detector/ponyfill` fallback for Firefox and Safari, neither of which has shipped the Barcode Detection API. The component feature-tests rather than sniffing, so that list is orientation only. Format whitelist is `["code_128", "qr_code"]`. CSP needs `script-src 'wasm-unsafe-eval'`; `Permissions-Policy: camera=(self)` is scoped to `/gear/loans*` only (`server/headers.server.ts` `securityHeadersForPath`).

**The ZXing WASM the ponyfill needs is copied into `public/zxing-wasm/` at build time by `scripts/sync-zxing-wasm.ts`** (chained into `dev` and `build` via `prepare:assets`, output gitignored) and served same-origin via `prepareZXingModule({ overrides.locateFile })` so `connect-src 'self'` stays sufficient. It resolves the binary _through_ `barcode-detector` so it always copies the exact nested `zxing-wasm` the ponyfill will load.

**The camera scanner was hand-vendored and committed, and that is what broke it.** The Emscripten glue JS and its `.wasm` are one artifact split across two files. They keep the same import/export surface across releases, so a stale binary instantiates cleanly and then throws `RuntimeError: table index is out of bounds` on the first decode. The `barcode-detector` 3.1.3 → 3.2.0 bump in #144 left the committed binary behind, and because the scan loop swallowed per-frame `detect()` errors, every ponyfill-path browser had a live camera preview that silently decoded nothing — no error, no toast, for months. The loop now counts consecutive `detect()` failures and surfaces a dead detector after 30, and `e2e/gear-scanner.spec.ts` drives a real QR through a real camera (Chromium fake-capture) so the decode seam is covered at all — see the testing rule.
