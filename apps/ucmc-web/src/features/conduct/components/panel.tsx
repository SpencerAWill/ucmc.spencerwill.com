import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

/**
 * One section of a record's case file: a titled card, with an optional
 * tag or control beside the title. The title names the landmark.
 */
export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("min-w-0 rounded-lg border bg-card", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="space-y-3 p-4 text-sm">{children}</div>
    </section>
  );
}
