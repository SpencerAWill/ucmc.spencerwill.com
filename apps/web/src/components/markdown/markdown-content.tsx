import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "#/lib/utils";

// `remark-breaks` turns single newlines into hard line breaks. This is
// a partial fix for legacy plain-text bodies (older feedback rows
// authored before the editor existed) — only single newlines are
// preserved; runs of spaces still collapse and any markdown syntax
// in the body still parses, neither of which the old
// `whitespace-pre-wrap` rendering did. Acceptable trade-off because
// the structured templates emit `**Bold**` separators that already
// rely on markdown parsing. `remark-gfm` adds task lists, tables,
// strikethrough, and autolinks.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

function isExternalHref(href: string | undefined): boolean {
  if (!href) {
    return false;
  }
  return /^https?:\/\//i.test(href);
}

const COMPONENTS: Parameters<typeof ReactMarkdown>[0]["components"] = {
  // Absolute http(s) links open in a new tab (treated as external —
  // we don't try to detect same-origin absolute URLs because authors
  // rarely paste them and the false-positive cost is just an extra
  // tab). Relative, fragment, and `mailto:` links stay in-tab so
  // navigation feels native. The rel pair is required to prevent
  // tab-nabbing when target=_blank is set.
  //
  // `node` is destructured out and dropped — react-markdown v9 passes
  // the mdast node to component overrides, and forwarding it onto
  // `<a>` triggers React's "Unknown prop `node` on DOM element" warning.
  a: ({ node: _node, href, children, ...rest }) => {
    if (isExternalHref(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
};

export function MarkdownContent({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    // First/last-child margin reset so the rendered prose slots into a
    // Card / form layout cleanly — without it, the `<p>`/`<h2>` margins
    // visibly leak above and below the wrapper and break the surrounding
    // `space-y-*` rhythm.
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
