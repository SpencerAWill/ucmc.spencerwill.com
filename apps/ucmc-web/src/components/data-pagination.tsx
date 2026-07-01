import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "#/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";

type DataPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  perPageOptions: ReadonlyArray<string>;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: string) => void;
};

/**
 * Build the page-button list with at most 7 visible slots (including
 * ellipsis markers). Strategy:
 *
 *   - ≤ 7 pages: render every page.
 *   - Near the start (current ≤ 4): 1 2 3 4 5 … last
 *   - Near the end  (current ≥ total−3): 1 … (last−4) (last−3) (last−2) (last−1) last
 *   - Middle: 1 … (curr−1) curr (curr+1) … last
 *
 * Returns either a page number or the literal `"ellipsis"`.
 */
function buildPageList(
  current: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }
  if (current >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [
    1,
    "ellipsis",
    current - 1,
    current,
    current + 1,
    "ellipsis",
    totalPages,
  ];
}

export function DataPagination({
  page,
  totalPages,
  total,
  perPage,
  perPageOptions,
  onPageChange,
  onPerPageChange,
}: DataPaginationProps) {
  const pageList = buildPageList(page, totalPages);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
          <span className="ml-1 hidden sm:inline">({total} total)</span>
        </span>
        <Select value={String(perPage)} onValueChange={onPerPageChange}>
          <SelectTrigger className="h-8 w-[7rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {perPageOptions.map((n) => (
              <SelectItem key={n} value={n}>
                {n} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={prevDisabled}
              tabIndex={prevDisabled ? -1 : 0}
              className={
                prevDisabled ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                if (!prevDisabled) onPageChange(page - 1);
              }}
            />
          </PaginationItem>
          {pageList.map((entry, i) =>
            entry === "ellipsis" ? (
              // Two ellipses can appear in the middle layout, so the
              // key uses both the marker and its position so React
              // doesn't collapse them.
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={entry}>
                <PaginationLink
                  href="#"
                  isActive={entry === page}
                  onClick={(e) => {
                    e.preventDefault();
                    if (entry !== page) onPageChange(entry);
                  }}
                >
                  {entry}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={nextDisabled}
              tabIndex={nextDisabled ? -1 : 0}
              className={
                nextDisabled ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                if (!nextDisabled) onPageChange(page + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
