/**
 * Opens the "Send feedback" dialog from anywhere in the shell.
 *
 * Feature-blind on purpose: the user menu (in `features/auth`) calls
 * `open()`, and `AppLayout` (in `components/layouts`, which may compose
 * features) provides the context and mounts the dialog. Nothing here
 * imports a feedback feature or a screenshot library — `capture` is
 * injected, so whether and how the page is captured is the layout's
 * decision.
 *
 * `open()` records the page *at the moment of asking*: the URL, the user
 * agent and (when enabled) a screenshot. It waits one frame first so the
 * menu that triggered it has started closing. A capture that rejects
 * opens the dialog without a screenshot rather than not at all.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface CapturedScreenshot {
  dataUrl: string;
  contentType: "image/webp" | "image/jpeg";
  bytes: number;
}

export interface FeedbackPageContext {
  pageUrl: string;
  userAgent: string;
  screenshot: CapturedScreenshot | null;
}

const USER_AGENT_MAX = 500;

interface LauncherValue {
  canSend: boolean;
  open: () => void;
  isOpen: boolean;
  context: FeedbackPageContext | null;
  close: () => void;
}

const LauncherContext = createContext<LauncherValue | null>(null);

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function FeedbackLauncherProvider({
  canSend,
  captureScreenshot,
  capture,
  children,
}: {
  canSend: boolean;
  captureScreenshot: boolean;
  capture: () => Promise<CapturedScreenshot | null>;
  children: React.ReactNode;
}) {
  const [context, setContext] = useState<FeedbackPageContext | null>(null);
  const opening = useRef(false);

  const open = useCallback(() => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    void (async () => {
      try {
        await nextFrame();
        // Read the page before awaiting the capture, so a navigation
        // during a slow capture can't change which page is reported.
        const pageUrl = window.location.href;
        const userAgent = navigator.userAgent.slice(0, USER_AGENT_MAX);
        const screenshot = captureScreenshot
          ? await capture().catch(() => null)
          : null;
        setContext({ pageUrl, userAgent, screenshot });
      } finally {
        opening.current = false;
      }
    })();
  }, [capture, captureScreenshot]);

  const close = useCallback(() => {
    setContext(null);
  }, []);

  const value = useMemo<LauncherValue>(
    () => ({ canSend, open, isOpen: context !== null, context, close }),
    [canSend, open, context, close],
  );

  return (
    <LauncherContext.Provider value={value}>
      {children}
    </LauncherContext.Provider>
  );
}

const NO_LAUNCHER = { canSend: false, open: () => {} };

/** For triggers: whether sending is possible, and how to start it. */
export function useFeedbackLauncher(): { canSend: boolean; open: () => void } {
  const value = useContext(LauncherContext);
  return value === null
    ? NO_LAUNCHER
    : { canSend: value.canSend, open: value.open };
}

/** For the dialog: what was recorded at `open()`, and how to dismiss it. */
export function useFeedbackLauncherState(): {
  isOpen: boolean;
  context: FeedbackPageContext | null;
  close: () => void;
} {
  const value = useContext(LauncherContext);
  if (value === null) {
    return { isOpen: false, context: null, close: () => {} };
  }
  return { isOpen: value.isOpen, context: value.context, close: value.close };
}
