import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List, LayoutGrid } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DataToolbar } from "#/components/data-toolbar";
import type { DataToolbarSortOption } from "#/components/data-toolbar";

const SORT_OPTIONS: DataToolbarSortOption<"name" | "created">[] = [
  { value: "name", label: "Name", ascLabel: "A → Z", descLabel: "Z → A" },
  {
    value: "created",
    label: "Date added",
    defaultDirection: "desc",
    ascLabel: "Oldest first",
    descLabel: "Newest first",
  },
];

const VIEW_OPTIONS = [
  { value: "list" as const, label: "List", icon: List },
  { value: "grid" as const, label: "Grid", icon: LayoutGrid },
];

describe("<DataToolbar />", () => {
  it("rounds the seam from the slots actually rendered, not from DOM position", () => {
    // The whole reason this isn't a plain `ButtonGroup`: with filters
    // omitted, search is the *first* segment and must keep its left
    // radius, even though `:first-child` rules would have applied to
    // whatever happened to render first.
    const { container } = render(
      <DataToolbar
        label="List controls"
        search={{ value: "", onChange: vi.fn() }}
        view={{ value: "list", options: VIEW_OPTIONS, onChange: vi.fn() }}
      />,
    );

    const [first, last] = Array.from(
      // Scoped by label, not `[role=group]`: the search InputGroup is
      // itself a role=group and would otherwise match.
      container.querySelectorAll<HTMLElement>(
        "[aria-label='List controls'] > *",
      ),
    );
    expect(first.className).not.toContain("md:rounded-l-none");
    expect(first.className).toContain("md:rounded-r-none");
    expect(last.className).toContain("md:rounded-l-none");
    expect(last.className).not.toContain("md:rounded-r-none");
  });

  it("omits the bulk segment entirely when nothing is selected", () => {
    const { rerender } = render(
      <DataToolbar
        label="List controls"
        bulkActions={{ selectedCount: 0, children: <div /> }}
        sort={{
          value: "name",
          direction: "asc",
          options: SORT_OPTIONS,
          onChange: vi.fn(),
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: /bulk actions/i })).toBeNull();

    rerender(
      <DataToolbar
        label="List controls"
        bulkActions={{ selectedCount: 3, children: <div /> }}
        sort={{
          value: "name",
          direction: "asc",
          options: SORT_OPTIONS,
          onChange: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /bulk actions \(3 selected\)/i }),
    ).toBeInTheDocument();
  });

  it("debounces typing into one commit, and flushes on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DataToolbar
        label="List controls"
        search={{ value: "", onChange, placeholder: "Search gear" }}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Search gear" });
    await user.type(input, "rope");
    // Each keystroke re-arms the timer, so four of them still owe the
    // caller exactly one commit — otherwise every letter is a history
    // entry and a server round trip.
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("rope");
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    await user.type(input, "s{Enter}");
    // Enter doesn't wait out the delay — it commits synchronously, and
    // cancels the pending timer rather than letting it fire again.
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("ropes");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("adopts a sort property's natural direction when switching to it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DataToolbar
        label="List controls"
        sort={{
          value: "name",
          direction: "asc",
          options: SORT_OPTIONS,
          onChange,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^sort/i }));
    // "Date added" declares `defaultDirection: "desc"`, so picking it
    // lands on newest-first rather than inheriting the name sort's asc.
    await user.click(screen.getByRole("menuitemradio", { name: "Date added" }));
    expect(onChange).toHaveBeenCalledWith({
      sort: "created",
      direction: "desc",
    });
  });

  it("shows the current direction on the sort trigger", () => {
    const { rerender } = render(
      <DataToolbar
        label="List controls"
        sort={{
          value: "created",
          direction: "desc",
          options: SORT_OPTIONS,
          onChange: vi.fn(),
        }}
      />,
    );
    // Direction is half the sort state; a neutral glyph would hide it
    // behind a click.
    expect(
      screen.getByRole("button", { name: "Sort: Date added, Newest first" }),
    ).toBeInTheDocument();

    rerender(
      <DataToolbar
        label="List controls"
        sort={{
          value: "created",
          direction: "asc",
          options: SORT_OPTIONS,
          onChange: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Sort: Date added, Oldest first" }),
    ).toBeInTheDocument();
  });

  it("spells out each applied filter as its own removable chip", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <DataToolbar
        label="List controls"
        filters={{
          activeCount: 2,
          chips: [
            { key: "affiliation:student", label: "Student", onRemove },
            { key: "role:officer", label: "Officer", onRemove: vi.fn() },
          ],
          children: <div />,
        }}
      />,
    );

    // The count badge says the list is restricted; only the chips say
    // what by — the question someone opening a shared URL has.
    await user.click(
      screen.getByRole("button", { name: "Remove filter: Student" }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("offers a way out of a selection", async () => {
    const user = userEvent.setup();
    const onClearSelection = vi.fn();

    render(
      <DataToolbar
        label="List controls"
        bulkActions={{
          selectedCount: 2,
          onClearSelection,
          children: <div />,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /bulk actions/i }));
    await user.click(screen.getByRole("menuitem", { name: "Clear selection" }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("labels the direction options per sort property", async () => {
    const user = userEvent.setup();

    render(
      <DataToolbar
        label="List controls"
        sort={{
          value: "created",
          direction: "desc",
          options: SORT_OPTIONS,
          onChange: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^sort/i }));
    // "Descending" says nothing about a date; the option supplies the
    // wording the user actually reasons about.
    expect(
      screen.getByRole("menuitemradio", { name: "Newest first" }),
    ).toBeChecked();
    expect(
      screen.queryByRole("menuitemradio", { name: "Descending" }),
    ).toBeNull();
  });
});
