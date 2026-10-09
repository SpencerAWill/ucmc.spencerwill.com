/**
 * Everything on a profile that belongs to an officer rather than to
 * the member: trip readiness, the field emergency card, and what
 * they are holding from the gear cave.
 *
 * **This is the point of the redesign.** These cards used to sit in
 * the main column, so every member's profile opened on waiver
 * standing and emergency contacts — which is why the page read as a
 * personnel record. Behind a tab, the profile leads with the person
 * and the compliance data is one tap away for the people who need it.
 *
 * Every section is gated on the caller's own permission check, done
 * through `hasPermission` by the route. A section must never be
 * gated on a field merely being present in the payload: the server
 * answers the REAL principal by design, so presence-gating silently
 * leaks officer data into an emulated member view.
 */
import { AlertTriangle, Check, X } from "lucide-react";

import { PhoneLink } from "#/components/phone-link";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { cn } from "#/lib/utils";

export type ReadinessState = "ok" | "warn" | "blocked";

export interface ReadinessItem {
  state: ReadinessState;
  label: string;
  /** Right-aligned on desktop, dropped under the label on a phone. */
  detail?: string | null;
}

// Palette classes rather than new tokens, matching how `Badge`'s
// own success/warning variants are built.
const STATE_STYLES: Record<ReadinessState, string> = {
  ok: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
  warn: "bg-amber-500 text-amber-950",
  blocked: "bg-destructive text-white",
};

const STATE_ICONS: Record<ReadinessState, typeof Check> = {
  ok: Check,
  warn: AlertTriangle,
  blocked: X,
};

export function TripReadiness({ items }: { items: ReadinessItem[] }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <h2 className="text-sm font-semibold">Trip readiness</h2>
        <ul className="space-y-2">
          {items.map((item) => {
            const Icon = STATE_ICONS[item.state];
            return (
              <li key={item.label} className="flex items-start gap-2.5 text-sm">
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                    STATE_STYLES[item.state],
                  )}
                >
                  <Icon className="size-3" aria-hidden="true" />
                  <span className="sr-only">{item.state}</span>
                </span>
                {/* Stacks under the label at phone width rather than
                    competing with it for a 390px line. */}
                <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="min-w-0">{item.label}</span>
                  {item.detail ? (
                    <span className="block text-xs text-muted-foreground sm:shrink-0 sm:text-right">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export interface EmergencyCardProps {
  phone: string | null;
  contacts: { name: string; phone: string; relationship: string }[];
}

/**
 * The card a trip leader reads in a parking lot with one bar of
 * signal, which is why the numbers are click-to-call and why it is
 * styled to be findable rather than tasteful.
 *
 * Scoped by `members:view_private` today. Narrowing it to the leaders
 * of a trip the member is actually on, for the duration of that trip,
 * needs trip rosters that do not exist yet (#257) — and the copy says
 * who can see it rather than implying a tighter scope than it has.
 */
export function FieldEmergencyCard({ phone, contacts }: EmergencyCardProps) {
  const hasAnything = Boolean(phone) || contacts.length > 0;

  return (
    <Card className="border-2 border-destructive">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-wide text-destructive uppercase">
            Field emergency card
          </h2>
          <Badge variant="outline">Officers only</Badge>
        </div>

        {hasAnything ? (
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            {phone ? (
              <>
                <dt className="text-muted-foreground">Member</dt>
                <dd>
                  <PhoneLink phone={phone} />
                </dd>
              </>
            ) : null}
            {contacts.map((contact, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground">
                  Contact{contacts.length > 1 ? ` ${i + 1}` : ""}
                </dt>
                <dd className="min-w-0">
                  <span className="break-words">{contact.name}</span>{" "}
                  <PhoneLink phone={contact.phone} />
                  <span className="ml-1 text-xs text-muted-foreground">
                    — {contact.relationship.replace(/_/g, " ")}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No emergency contact on file. Worth chasing before they go out.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
