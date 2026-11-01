import { cn } from "#/lib/utils";
import { CONDUCT_LEVEL_LABELS } from "#/features/conduct/server/limits";

export type ConductLevelKey = keyof typeof CONDUCT_LEVEL_LABELS;

/** How many of the meter's four steps each level fills. */
const LEVEL_STEPS: Record<ConductLevelKey, number> = {
  note: 1,
  warning: 2,
  suspension: 3,
  termination: 4,
};

/**
 * Each level's fill, for the meter and for anything that carries the
 * level's colour (a row stripe, the record header band). The tokens are
 * held to 3:1 against the card in `notice-contrast.test.tsx`.
 */
export const LEVEL_FILL: Record<ConductLevelKey, string> = {
  note: "bg-conduct-note",
  warning: "bg-conduct-warning",
  suspension: "bg-conduct-suspension",
  termination: "bg-conduct-termination",
};

/**
 * A level as a four-step meter beside its name. The meter is decoration
 * (`aria-hidden`); the name carries the meaning, so colour is never the
 * only signal.
 */
export function SeverityMark({
  level,
  size = "sm",
  className,
}: {
  level: ConductLevelKey;
  size?: "sm" | "lg";
  className?: string;
}) {
  const steps = LEVEL_STEPS[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-medium whitespace-nowrap",
        size === "lg" ? "text-base" : "text-sm",
        className,
      )}
    >
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "rounded-[2px]",
              size === "lg" ? "w-2" : "w-1.5",
              // Rising heights read as "more" before the colour does.
              size === "lg"
                ? ["h-2", "h-3", "h-4", "h-5"][step - 1]
                : ["h-1.5", "h-2", "h-2.5", "h-3"][step - 1],
              step <= steps ? LEVEL_FILL[level] : "bg-border",
            )}
          />
        ))}
      </span>
      {CONDUCT_LEVEL_LABELS[level]}
    </span>
  );
}
