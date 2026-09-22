/**
 * The one way an image picker reports a rejected file.
 *
 * It's a component rather than a line of JSX per call site because five
 * editors share `useImageCrop` and every one of them was rendering
 * *nothing* for a failed pick — the hook had no `error` to render. A
 * shared component means a sixth editor gets the reporting by wiring one
 * element, instead of by remembering that it needs to.
 *
 * `role="alert"` so the message is announced: the failure happens after
 * the OS file picker closes, by which point focus is back on the page
 * and a silently-appearing paragraph is easy to miss — particularly on a
 * phone, where the picker covered the whole screen.
 */
export function ImagePickerError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
