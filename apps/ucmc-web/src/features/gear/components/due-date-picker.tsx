import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { isoWeekdayFromDate, WEEKDAY_NAMES } from "#/lib/weekdays";

/**
 * Date-picker control for "due on" expressed as a durationDays number.
 *
 * The wire format on the server is `durationDays`. Officers think in
 * dates, not day counts, so this control accepts a date pick and
 * derives the integer-day duration alongside; the parent stores
 * `durationDays`. A small "(N days)" indicator next to the picker
 * surfaces the derived count so the officer can see at a glance how
 * long they're committing the gear for.
 *
 * Anchored to midnight local-time so the date-to-days round-trip
 * stays stable through the day. Same-day loans (0 days) are allowed
 * for exec-meeting-style "out for the meeting, back this evening"
 * checkouts; `computeDueAt` on the server snaps the dueAt to
 * end-of-day so a 0-day loan isn't already overdue.
 *
 * `caveOpenWeekdays` only ever produces a **hint**. The officer's pick is
 * never rewritten and never rejected: off-cycle returns are legitimate,
 * and the control and the submitted value must agree about what was just
 * agreed with the member (#242). The prefill is where the cave's hours are
 * actually applied — see `defaultLoanDurationDays`.
 *
 * Known limitation: the hint reads the weekday off the **runtime-local**
 * due date, matching the rest of this control, while the prefill reasons
 * in `CLUB_TIME_ZONE`. Identical for anyone at the cave, and divergent by
 * a day only for an officer whose browser zone puts them on a different
 * calendar date — who would then see the hint fire on the prefilled
 * value. Not worth re-basing the whole control's date arithmetic for; it
 * is an advisory line, and the date shown is still the date submitted.
 */

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function DueDatePicker({
  id,
  label = "Due",
  durationDays,
  onDurationChange,
  disabled,
  compact = false,
  caveOpenWeekdays = [],
}: {
  id: string;
  /** Inline label rendered immediately to the left of the input.
   *  Pass an empty string when the caller has its own outer label. */
  label?: string;
  durationDays: number;
  onDurationChange: (days: number) => void;
  disabled?: boolean;
  /** Use the smaller `h-8` height for embedded contexts (a row inside
   *  a list item). Default `false` matches the standard form-control
   *  size (`h-9`) so the picker lines up next to other inputs at the
   *  top of a form. */
  compact?: boolean;
  /** ISO weekday numbers (Mon = 1 … Sun = 7) the gear cave is open. Drives
   *  the advisory line under the control; empty disables it entirely. */
  caveOpenWeekdays?: readonly number[];
}) {
  const today = startOfDay(new Date());
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + durationDays);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 90);
  // A 0-day loan is the exec-meeting "out and back this evening" case —
  // it is handed back in the room, not at the cave, so the cave's hours
  // say nothing about it.
  const caveShut =
    durationDays > 0 &&
    caveOpenWeekdays.length > 0 &&
    !caveOpenWeekdays.includes(isoWeekdayFromDate(dueDate));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {label ? (
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            {label}
          </Label>
        ) : null}
        <Input
          id={id}
          type="date"
          min={toIsoDate(today)}
          max={toIsoDate(maxDate)}
          value={toIsoDate(dueDate)}
          disabled={disabled}
          onChange={(e) => {
            const [y, m, d] = e.target.value
              .split("-")
              .map((n) => Number.parseInt(n, 10));
            if (
              !Number.isFinite(y) ||
              !Number.isFinite(m) ||
              !Number.isFinite(d)
            ) {
              return;
            }
            const picked = startOfDay(new Date(y, m - 1, d));
            const diffMs = picked.getTime() - today.getTime();
            const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
            if (days >= 0 && days <= 90) onDurationChange(days);
          }}
          className={compact ? "h-8 w-auto" : "w-auto"}
        />
        <span className="text-xs text-muted-foreground">
          {durationDays === 0
            ? "(same day)"
            : `(${durationDays} ${durationDays === 1 ? "day" : "days"})`}
        </span>
      </div>
      {caveShut ? (
        // Advisory, not an error — `text-muted-foreground` rather than
        // `text-destructive`, because an off-cycle return is a normal
        // thing an officer may be arranging on purpose.
        <p className="text-xs text-muted-foreground">
          Cave shut that day — open{" "}
          {caveOpenWeekdays
            .map((day) => WEEKDAY_NAMES[day - 1])
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      ) : null}
    </div>
  );
}
