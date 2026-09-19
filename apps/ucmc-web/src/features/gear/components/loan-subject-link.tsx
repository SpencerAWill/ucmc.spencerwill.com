import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Links to an item's detail page when the loan names one, and renders a
 * plain wrapper when it doesn't.
 *
 * A counted loan ("six quickdraws") has no single unit behind it and so
 * no `/gear/$publicId` to open. Every loan surface hits this, so the
 * branch lives here rather than being re-derived at each call site — an
 * `<a>` with no `href` still reads as a link to a screen reader, which
 * is the failure mode this exists to prevent.
 */
export function LoanSubjectLink({
  publicId,
  className,
  children,
}: {
  publicId: string | null;
  className?: string;
  children: ReactNode;
}) {
  if (publicId === null) {
    return <div className={className}>{children}</div>;
  }
  return (
    <Link to="/gear/$publicId" params={{ publicId }} className={className}>
      {children}
    </Link>
  );
}
