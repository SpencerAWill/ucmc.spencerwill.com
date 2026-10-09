/**
 * The exact-value view of everything the meters and sparklines show.
 *
 * Every chart on this page is also readable here — the accessibility
 * guide's "linked table" pattern, and the obligation our own palette
 * notes impose on any chart using the lower-contrast slots.
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import {
  formatHeadroom,
  formatQuantity,
} from "#/features/analytics/lib/headroom";
import type { ServiceHeadroom } from "#/features/analytics/server/analytics-fns";

export function SnapshotTable({ services }: { services: ServiceHeadroom[] }) {
  return (
    <div className="overflow-x-auto overflow-y-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Family</TableHead>
            <TableHead className="text-right">Peak</TableHead>
            <TableHead className="text-right">Free tier</TableHead>
            <TableHead className="text-right">Used</TableHead>
            <TableHead>Peak day</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.service}>
              <TableCell className="font-medium">{service.label}</TableCell>
              <TableCell className="text-muted-foreground">
                {service.family ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQuantity(service.peak)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {service.freeLimit === null
                  ? "—"
                  : `${formatQuantity(service.freeLimit)}/${service.limitPeriod === "day" ? "day" : "mo"}`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {service.fraction === null
                  ? "no limit"
                  : formatHeadroom(service.fraction)}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {service.peakDay}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
