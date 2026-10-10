/**
 * Which notification categories actually drive sending.
 *
 * Counts rather than a chart: there are a handful of categories and
 * the useful operation is reading one number beside another, which a
 * table does better than bars at this N.
 *
 * Failures get their own column rather than being folded into the
 * total. A rejected send still consumed quota AND still means a member
 * did not get their email — two different problems that a single
 * "sent" figure would hide.
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatQuantity } from "#/features/analytics/lib/headroom";
import type { EmailVolume } from "#/features/analytics/server/analytics-fns";

export function EmailVolumeTable({ emails }: { emails: EmailVolume[] }) {
  const totalSent = emails.reduce((sum, row) => sum + row.sent, 0);
  const totalFailed = emails.reduce((sum, row) => sum + row.failed, 0);
  return (
    <div className="overflow-x-auto overflow-y-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Notification</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead className="text-right">Rejected</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {emails.map((row) => (
            <TableRow key={row.kind}>
              <TableCell className="font-medium">{row.kind}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQuantity(row.sent)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.failed === 0 ? (
                  <span className="text-muted-foreground">0</span>
                ) : (
                  <span className="text-destructive">
                    {formatQuantity(row.failed)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="font-medium">
            <TableCell>All categories</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatQuantity(totalSent)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatQuantity(totalFailed)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
