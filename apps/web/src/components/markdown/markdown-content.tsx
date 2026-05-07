import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "#/lib/utils";

// `remark-breaks` turns single newlines into hard line breaks, matching
// the old `whitespace-pre-wrap` rendering for legacy plain-text bodies
// (older feedback rows authored before the editor existed). `remark-gfm`
// adds task lists, tables, strikethrough, and autolinks.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

function isExternalHref(href: string | undefined): boolean {
  if (!href) {
    return false;
  }
  return /^https?:\/\//i.test(href);
}

const COMPONENTS: Parameters<typeof ReactMarkdown>[0]["components"] = {
  // External links open in a new tab; internal/relative links stay
  // in-tab so navigation feels native. The rel pair is required to
  // prevent tab-nabbing when target=_blank is set.
  a: ({ href, children, ...rest }) => {
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
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
