/**
 * A phone number rendered readably and, when it's dialable, as a
 * click-to-call link.
 *
 * It's a component rather than two calls to `formatPhone` / `phoneHref`
 * at each site because the link/plain-text branch is the part that
 * would drift: the `undefined` href case has to degrade to a bare
 * `<span>` (an `<a>` with no href is a non-interactive element that
 * still looks like a link), and every call site re-deciding that is how
 * one of them ends up emitting `tel:` for a number the dialer can't
 * complete. Kept presentational and query-free so it can live in
 * `src/components/` — see `<SocialIconLinks>` for the same shape.
 *
 * Click-to-call is the point on mobile: emergency contacts are read on
 * a phone, in a situation where retyping ten digits is the last thing
 * anyone should be doing.
 */
import { formatPhone, phoneHref } from "#/lib/phone-format";
import { cn } from "#/lib/utils";

export interface PhoneLinkProps {
  /** E.164 as stored (`+15135551234`). Blank/null renders `fallback`. */
  phone: string | null | undefined;
  /** Rendered when there's no number on file. Defaults to nothing. */
  fallback?: React.ReactNode;
  className?: string;
}

export function PhoneLink({
  phone,
  fallback = null,
  className,
}: PhoneLinkProps) {
  const display = formatPhone(phone);
  if (!display) {
    return <>{fallback}</>;
  }

  const href = phoneHref(phone);
  if (!href) {
    return <span className={className}>{display}</span>;
  }

  return (
    <a
      href={href}
      className={cn(
        "underline-offset-4 hover:underline focus-visible:underline",
        className,
      )}
    >
      {display}
    </a>
  );
}
