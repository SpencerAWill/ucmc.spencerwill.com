/**
 * The two safety clocks for a counted model.
 *
 * Both were structurally unanswerable for counted gear until recently:
 * the service-life clock ran off `gear_items.manufactured_at` and a
 * counted model has no items, and the inspection clock ran off a
 * per-item log nothing could write a model row into. So a bin of
 * ten-year slings reported "age unknown" and "never inspected" no matter
 * what the cave did about it.
 *
 * Only flagged statuses render, matching the item list: `ok` and
 * `untracked` are the quiet majority and badging them would make the
 * list all badge and no signal.
 *
 * Takes the four fields it reads rather than a whole DTO, because its
 * two callers carry different ones — the officer catalog list and the
 * narrower inspection worklist, which deliberately omits everything an
 * inspector has no business seeing.
 */
import { Badge } from "#/components/ui/badge";
import {
  INSPECTION_STATUS_LABEL,
  SERVICE_LIFE_STATUS_LABEL,
  inspectionState,
  isSafetyFlag,
  serviceLifeState,
} from "#/features/gear/lib/safety";

export interface GearModelSafetyInput {
  effectiveInspectionIntervalDays: number | null;
  lastInspectedAtMs: number | null;
  serviceLifeYears: number | null;
  manufacturedAtMs: number | null;
}

export function GearModelSafetyBadges({
  model,
}: {
  model: GearModelSafetyInput;
}) {
  const now = Temporal.Now.instant();
  const inspection = inspectionState({
    intervalDays: model.effectiveInspectionIntervalDays,
    lastInspectedAt:
      model.lastInspectedAtMs === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(model.lastInspectedAtMs),
    now,
  });
  const serviceLife = serviceLifeState({
    serviceLifeYears: model.serviceLifeYears,
    manufacturedAt:
      model.manufacturedAtMs === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(model.manufacturedAtMs),
    now,
  });
  return (
    <>
      {isSafetyFlag(inspection.status) ? (
        <Badge
          variant={
            inspection.status === "overdue" || inspection.status === "never"
              ? "destructive"
              : "secondary"
          }
        >
          {INSPECTION_STATUS_LABEL[inspection.status]}
        </Badge>
      ) : null}
      {isSafetyFlag(serviceLife.status) ? (
        <Badge
          variant={
            serviceLife.status === "expired" ? "destructive" : "secondary"
          }
        >
          {SERVICE_LIFE_STATUS_LABEL[serviceLife.status]}
        </Badge>
      ) : null}
    </>
  );
}
