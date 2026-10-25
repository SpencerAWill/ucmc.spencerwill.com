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
 * Each capture tags its marks with its own id. A capture abandoned at the
 * timeout keeps rasterising in the background, and when it finally
 * settles its cleanup must not strip the marks a newer capture (the
 * member closed and reopened the dialog) is relying on.
 */
const runs = { next: 0 };

/**
 * When the page is scrolled, the clone is shifted up by the scroll so the
 * capture shows the viewport. Fixed and sticky chrome (the header, the
 * sidebar) would move with it, so each outermost one is marked with the
 * offset that puts it back where the member sees it: the scroll for a
 * fixed element (the shifted root becomes its containing block), and
 * stuck-minus-in-flow position for a sticky one, measured by un-sticking
 * it for one synchronous read. Returns the cleanup, which removes only
 * this run's marks and is safe to call twice.
 */
function markChrome(runId: string): () => void {
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
      const inline = el.style.getPropertyValue("position");
      const priority = el.style.getPropertyPriority("position");
      el.style.setProperty("position", "static", "important");
      const inFlow = el.getBoundingClientRect();
      el.style.setProperty("position", inline, priority);
      dx = stuck.left - inFlow.left;
      dy = stuck.top - inFlow.top;
    }
    el.setAttribute(SHIFT_ATTR, `${runId}|${dx},${dy}`);
    marked.push(el);
  }
  return () => {
    for (const el of marked) {
      if (el.getAttribute(SHIFT_ATTR)?.startsWith(`${runId}|`)) {
        el.removeAttribute(SHIFT_ATTR);
      }
    }
  };
}

function shiftClone(node: Node, runId: string): void {
  if (!(node instanceof HTMLElement) || !node.hasAttribute(SHIFT_ATTR)) {
    return;
  }
  const [owner, offset = ""] = (node.getAttribute(SHIFT_ATTR) ?? "").split("|");
  node.removeAttribute(SHIFT_ATTR);
  if (owner !== runId) {
    return;
  }
  const [dx, dy] = offset.split(",");
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

interface CaptureRun {
  id: string;
  /** Replaced once the chrome is marked; removes this run's marks. */
  unmark: () => void;
}

async function encode(
  run: CaptureRun,
  maxBytes: number,
  maxWidth: number,
  timeoutMs: number,
) {
  const { domToJpeg, domToWebp } = await import("modern-screenshot");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scrolled = window.scrollX !== 0 || window.scrollY !== 0;
  const options = {
    width,
    height,
    scale: Math.min(window.devicePixelRatio || 1, maxWidth / width),
    filter: keep,
    // Image fetches give up with the capture rather than running on.
    timeout: timeoutMs,
    // A fresh URL per image fetch. A copy cached from a plain <img> (no
    // Origin, so no CORS header) would otherwise be reused for this
    // cross-origin read and render blank, and Cloudflare's edge ignores
    // `Vary: Origin`, so the public bucket's CORS rule alone can't help.
    fetch: { bypassingCache: true },
    // Shift the page so the clone starts at the scroll position: the
    // capture is the viewport, not the top of the document.
    ...(scrolled
      ? {
          style: {
            transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
          },
          onCloneEachNode: (node: Node) => shiftClone(node, run.id),
        }
      : {}),
  };
  const root = document.documentElement;
  if (scrolled) {
    run.unmark = markChrome(run.id);
  }
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
    run.unmark();
  }
}

export async function captureViewport(
  opts: { timeoutMs?: number; maxWidth?: number; maxBytes?: number } = {},
): Promise<CapturedScreenshot | null> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const maxWidth = opts.maxWidth ?? 1600;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  runs.next += 1;
  const run: CaptureRun = { id: String(runs.next), unmark: () => {} };
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
  const timeout = new Promise<null>((resolve) => {
    timer.id = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([
      encode(run, maxBytes, maxWidth, timeoutMs),
      timeout,
    ]);
    return result === null
      ? null
      : { ...result, bytes: decodedBytes(result.dataUrl) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer.id);
    // On a timeout the abandoned encode may run on for a while; take the
    // marks off the live page now rather than when it settles.
    run.unmark();
  }
}
