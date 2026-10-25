/**
 * Capture what the member can see right now as an uploadable image.
 *
 * `modern-screenshot` re-renders the DOM into a canvas (there is no
 * browser API for a real screenshot without a permission prompt), so the
 * result is close to the page but not pixel-exact. It is loaded on
 * demand, keeping it out of every page's bundle.
 *
 * Tries WebP, falls back to JPEG (Safari's canvas can't encode WebP and
 * returns a PNG), then a lower JPEG quality, and gives up with `null` if
 * nothing fits under `maxBytes`, the capture throws, or it takes longer
 * than `timeoutMs`. The caller treats `null` as "no screenshot", never as
 * an error.
 */
import type { CapturedScreenshot } from "#/components/feedback/feedback-launcher";

/** Matches the server's cap (`SITE_FEEDBACK_SCREENSHOT_MAX_BYTES`). */
const DEFAULT_MAX_BYTES = 1_048_576;

// Open menus and popovers (Radix portals them into this wrapper), and
// anything the app marks, such as the feedback dialog itself.
const EXCLUDE_SELECTOR =
  "[data-radix-popper-content-wrapper], [data-feedback-capture-exclude]";

function keep(node: Node): boolean {
  return !(node instanceof Element && node.matches(EXCLUDE_SELECTOR));
}

const SHIFT_ATTR = "data-feedback-capture-shift";

/**
 * When the page is scrolled, the clone is shifted up by the scroll so the
 * capture shows the viewport. Fixed and sticky chrome (the header, the
 * sidebar) would move with it, so each outermost one is marked with the
 * offset that puts it back where the member sees it: the scroll for a
 * fixed element (the shifted root becomes its containing block), and
 * stuck-minus-in-flow position for a sticky one, measured by un-sticking
 * it for one synchronous read. Returns the cleanup.
 */
function markChrome(): () => void {
  const marked: HTMLElement[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") {
      continue;
    }
    if (marked.some((outer) => outer.contains(el))) {
      continue;
    }
    let dx = window.scrollX;
    let dy = window.scrollY;
    if (position === "sticky") {
      const stuck = el.getBoundingClientRect();
      const inline = el.style.position;
      el.style.position = "static";
      const inFlow = el.getBoundingClientRect();
      el.style.position = inline;
      dx = stuck.left - inFlow.left;
      dy = stuck.top - inFlow.top;
    }
    el.setAttribute(SHIFT_ATTR, `${dx},${dy}`);
    marked.push(el);
  }
  return () => {
    for (const el of marked) {
      el.removeAttribute(SHIFT_ATTR);
    }
  };
}

function shiftClone(node: Node): void {
  if (!(node instanceof HTMLElement) || !node.hasAttribute(SHIFT_ATTR)) {
    return;
  }
  const [dx, dy] = (node.getAttribute(SHIFT_ATTR) ?? "0,0").split(",");
  node.removeAttribute(SHIFT_ATTR);
  const own = node.style.transform;
  const rest = own && own !== "none" ? ` ${own}` : "";
  node.style.transform = `translate(${dx}px, ${dy}px)${rest}`;
}

/** Decoded size of a base64 data URL, without decoding it. */
function decodedBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

async function encode(maxBytes: number, maxWidth: number) {
  const { domToJpeg, domToWebp } = await import("modern-screenshot");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scrolled = window.scrollX !== 0 || window.scrollY !== 0;
  const options = {
    width,
    height,
    scale: Math.min(window.devicePixelRatio || 1, maxWidth / width),
    filter: keep,
    // Shift the page so the clone starts at the scroll position: the
    // capture is the viewport, not the top of the document.
    ...(scrolled
      ? {
          style: {
            transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
          },
          onCloneEachNode: shiftClone,
        }
      : {}),
  };
  const root = document.documentElement;
  const unmark = scrolled ? markChrome() : () => {};
  try {
    const webp = await domToWebp(root, { ...options, quality: 0.8 });
    if (webp.startsWith("data:image/webp") && decodedBytes(webp) <= maxBytes) {
      return { dataUrl: webp, contentType: "image/webp" as const };
    }
    for (const quality of [0.8, 0.6]) {
      const jpeg = await domToJpeg(root, { ...options, quality });
      if (decodedBytes(jpeg) <= maxBytes) {
        return { dataUrl: jpeg, contentType: "image/jpeg" as const };
      }
    }
    return null;
  } finally {
    unmark();
  }
}

export async function captureViewport(
  opts: { timeoutMs?: number; maxWidth?: number; maxBytes?: number } = {},
): Promise<CapturedScreenshot | null> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const maxWidth = opts.maxWidth ?? 1600;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([encode(maxBytes, maxWidth), timeout]);
    return result === null
      ? null
      : { ...result, bytes: decodedBytes(result.dataUrl) };
  } catch {
    return null;
  }
}
