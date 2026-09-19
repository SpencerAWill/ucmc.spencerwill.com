/**
 * The toolbar's design surface. Resize the preview across ~768px to see
 * the connected desktop bar break into a full-width search row over
 * spaced icon buttons, and the filter popover become a bottom drawer.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LayoutGrid, List, Rows3 } from "lucide-react";
import { useState } from "react";

import { DataToolbar } from "#/components/data-toolbar";
import type {
  DataToolbarFilterChip,
  SortDirection,
} from "#/components/data-toolbar";
import { Checkbox } from "#/components/ui/checkbox";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu";
import { Label } from "#/components/ui/label";

type SortKey = "code" | "created";
type View = "list" | "grid" | "table";

const SORT_OPTIONS = [
  {
    value: "code" as const,
    label: "Code",
    ascLabel: "A → Z",
    descLabel: "Z → A",
  },
  {
    value: "created" as const,
    label: "Date added",
    defaultDirection: "desc" as const,
    ascLabel: "Oldest first",
    descLabel: "Newest first",
  },
];

const VIEW_OPTIONS = [
  { value: "list" as const, label: "List", icon: List },
  { value: "grid" as const, label: "Grid", icon: LayoutGrid },
  { value: "table" as const, label: "Table", icon: Rows3 },
];

const TAGS = ["Winter", "Rope", "Loaned out"];

function Harness({
  slots,
  selectedCount = 0,
}: {
  slots: {
    search?: boolean;
    filters?: boolean;
    sort?: boolean;
    view?: boolean;
  };
  selectedCount?: number;
}) {
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("code");
  const [dir, setDir] = useState<SortDirection>("asc");
  const [view, setView] = useState<View>("list");

  const chips: DataToolbarFilterChip[] = tags.map((tag) => ({
    key: `tag:${tag}`,
    label: tag,
    onRemove: () => setTags((prev) => prev.filter((t) => t !== tag)),
  }));

  return (
    <div className="w-full max-w-5xl p-4">
      <DataToolbar
        label="Demo list controls"
        search={
          slots.search
            ? { value: q, onChange: setQ, placeholder: "Search…" }
            : undefined
        }
        filters={
          slots.filters
            ? {
                activeCount: chips.length,
                chips,
                onClear: () => setTags([]),
                title: "Filter items",
                children: (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      Tags
                    </Label>
                    {TAGS.map((tag) => (
                      <label
                        key={tag}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={tags.includes(tag)}
                          onCheckedChange={() =>
                            setTags((prev) =>
                              prev.includes(tag)
                                ? prev.filter((t) => t !== tag)
                                : [...prev, tag],
                            )
                          }
                        />
                        {tag}
                      </label>
                    ))}
                  </div>
                ),
              }
            : undefined
        }
        bulkActions={
          selectedCount > 0
            ? {
                selectedCount,
                onClearSelection: () => undefined,
                children: (
                  <>
                    <DropdownMenuItem>Print labels…</DropdownMenuItem>
                    <DropdownMenuItem>Add tags…</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive">
                      Retire…
                    </DropdownMenuItem>
                  </>
                ),
              }
            : undefined
        }
        sort={
          slots.sort
            ? {
                value: sort,
                direction: dir,
                options: SORT_OPTIONS,
                onChange: (next) => {
                  setSort(next.sort);
                  setDir(next.direction);
                },
              }
            : undefined
        }
        view={
          slots.view
            ? { value: view, options: VIEW_OPTIONS, onChange: setView }
            : undefined
        }
      />
    </div>
  );
}

const meta = {
  title: "Data/DataToolbar",
  component: Harness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllSlots: Story = {
  args: {
    slots: { search: true, filters: true, sort: true, view: true },
  },
};

/** What the bar looks like mid-selection — the bulk segment appears
 *  between search and sort, and the seams re-close around it. */
export const WithSelection: Story = {
  args: {
    slots: { search: true, filters: true, sort: true, view: true },
    selectedCount: 3,
  },
};

/** A page with nothing to filter or sort by. The seam rounding is
 *  computed from the rendered slots, so search keeps both radii. */
export const SearchOnly: Story = {
  args: { slots: { search: true } },
};

/** A dataset with no free-text index behind it. */
export const NoSearch: Story = {
  args: { slots: { filters: true, sort: true, view: true } },
};
