import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "#/lib/utils";

const REMARK_PLUGINS = [remarkGfm];

const COMPONENTS: Parameters<typeof ReactMarkdown>[0]["components"] = {
  // External links open in a new tab; the rel pair is required to prevent
  // tab-nabbing when target=_blank is set.
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ),
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
