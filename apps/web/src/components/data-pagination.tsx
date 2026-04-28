import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
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

export function DataPagination({
  page,
  totalPages,
  total,
  perPage,
  perPageOptions,
  onPageChange,
  onPerPageChange,
}: DataPaginationProps) {
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
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="size-4" />
              <span className="sr-only">Next page</span>
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
