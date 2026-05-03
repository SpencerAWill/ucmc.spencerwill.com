import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import TanStackQueryDevtools from "../lib/tanstack-query/devtools";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

import { AppLayout } from "#/components/layouts/app-layout";
import { RouteErrorFallback } from "#/components/error-page";
import { ThemeProvider } from "#/components/theme-provider";
import { Toaster } from "#/components/ui/sonner";
import { sessionQueryOptions } from "#/features/auth/api/use-auth";
import { ViewModeProvider } from "#/features/auth/api/view-mode";

interface RouterContext {
  queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('ucmc-ui-theme');var mode=(stored==='light'||stored==='dark'||stored==='system')?stored:'system';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<RouterContext>()({
  // Prefetch the session on every SSR render so `useAuth()` hydrates with
  // the correct state (UserMenu renders signed-in immediately instead of
  // flashing the anonymous fallback).
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(sessionQueryOptions()),
  errorComponent: RouteErrorFallback,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "UC Mountaineering Club" },
      // Search-engine description — kept short enough to render in
      // SERP snippets. Mirrors the "what UCMC is" framing on /about.
      {
        name: "description",
        content:
          "Official member portal for the University of Cincinnati Mountaineering Club — registered student organization for climbers, mountaineers, and outdoor enthusiasts at UC.",
      },
      // Open Graph (Facebook / Slack / Discord / iMessage previews).
      // Routes that want a more specific title or description can
      // override these via their own `head` block; the values here
      // are the all-pages default.
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "UC Mountaineering Club" },
      { property: "og:title", content: "UC Mountaineering Club" },
      {
        property: "og:description",
        content:
          "Official member portal for the University of Cincinnati Mountaineering Club.",
      },
      {
        property: "og:image",
        content: "https://ucmc.spencerwill.com/logo512.png",
      },
      // Twitter / X card. `summary` (square logo) rather than
      // `summary_large_image` since we don't yet have a 1200x630
      // banner; revisit when we do.
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "UC Mountaineering Club" },
      {
        name: "twitter:description",
        content:
          "Official member portal for the University of Cincinnati Mountaineering Club.",
      },
      {
        name: "twitter:image",
        content: "https://ucmc.spencerwill.com/logo512.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased wrap-anywhere selection:bg-[rgba(79,184,178,0.24)]">
        <ThemeProvider>
          <ViewModeProvider>
            <AppLayout>{children}</AppLayout>
          </ViewModeProvider>
          <Toaster richColors position="bottom-right" />
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
