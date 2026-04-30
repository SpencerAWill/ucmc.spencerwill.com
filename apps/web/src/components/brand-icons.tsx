/**
 * Inline-SVG brand icons for the footer's external-link row. Lucide's
 * monochrome stroke icons are great for UI but undersell the actual
 * brand identity for first-party links — the marks here are pulled
 * from each platform's official brand guidelines (paths borrowed from
 * Simple Icons, https://simpleicons.org/) and rendered with their
 * canonical colors so the row reads as "go off-platform to us".
 *
 * Both components forward `className` so callers can size them with
 * Tailwind's `size-4` / `size-5` etc., matching the lucide pattern.
 */
import type { SVGProps } from "react";

export function InstagramIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  // Renders as a rounded gradient square with a white camera glyph
  // overlaid — the layered "real" app-icon look rather than the
  // mono-glyph silhouette. Drawn as four primitives so each visual
  // layer is independently styleable: gradient backdrop, camera body
  // outline, lens outline, viewfinder dot.
  //
  // The gradient ID is suffixed with `ucmc-` so it can't collide with
  // a third-party gradient defined elsewhere on the page.
  const gradientId = "ucmc-instagram-gradient";
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <defs>
        <radialGradient
          id={gradientId}
          cx="0.3"
          cy="1.07"
          r="1.15"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0" stopColor="#FFDC80" />
          <stop offset="0.1" stopColor="#FCAF45" />
          <stop offset="0.25" stopColor="#F77737" />
          <stop offset="0.4" stopColor="#F56040" />
          <stop offset="0.55" stopColor="#FD1D1D" />
          <stop offset="0.7" stopColor="#E1306C" />
          <stop offset="0.85" stopColor="#C13584" />
          <stop offset="1" stopColor="#5851DB" />
        </radialGradient>
      </defs>
      {/* Backdrop — rounded square with the radial gradient. */}
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="6"
        fill={`url(#${gradientId})`}
      />
      {/* Camera body outline. */}
      <rect
        x="5.5"
        y="5.5"
        width="13"
        height="13"
        rx="3.5"
        fill="none"
        stroke="white"
        strokeWidth="1.6"
      />
      {/* Lens. */}
      <circle
        cx="12"
        cy="12"
        r="3.5"
        fill="none"
        stroke="white"
        strokeWidth="1.6"
      />
      {/* Viewfinder dot. */}
      <circle cx="17" cy="7" r="1" fill="white" />
    </svg>
  );
}

export function FacebookIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  // Facebook's brand color is `#1877F2`. The mark is a white "f" inset
  // into a blue circle — drawn as the canonical Simple Icons path with
  // the brand color baked in so it stays Facebook-blue in both light
  // and dark modes (the platform doesn't have an inverted variant).
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        fill="#1877F2"
        d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"
      />
    </svg>
  );
}

export function YouTubeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  // YouTube's brand color is `#FF0000` — the red tile with a white
  // "play" triangle. Drawn as the canonical Simple Icons path with
  // the brand red baked in so the mark stays YouTube-red in both
  // light and dark modes.
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        fill="#FF0000"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
      />
    </svg>
  );
}

export function GitHubIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  // GitHub's brand color is `#181717` (near-black). On dark
  // backgrounds the mark is typically inverted to white — we render
  // with `currentColor` only on the foreground stroke side and a
  // theme-aware fill so the link adapts: explicit dark color in
  // light mode, white in dark mode (controlled by the consuming
  // `dark:` utility on the wrapper).
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}
