import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PastOfficers } from "#/features/history/components/past-officers";
import type { OfficerYearGroup } from "#/features/history/server/history-fns";

function group(
  schoolYear: string,
  startYear: number,
  officers: { role: string; name: string }[],
): OfficerYearGroup {
  return {
    schoolYear,
    startYear,
    officers: officers.map((o, idx) => ({
      id: startYear * 100 + idx,
      role: o.role,
      roleOrder: idx + 1,
      name: o.name,
      notes: null,
    })),
  };
}

const GROUPS: OfficerYearGroup[] = [
  group("2022-23", 2022, [
    { role: "President", name: "Deyer Graffice & Alyssa Polito" },
    { role: "Vice-President", name: "Trevor Darst" },
  ]),
  group("2021-22", 2021, [
    { role: "President", name: "Rob Olszewski" },
    { role: "Vice-President", name: "Deyer Graffice" },
  ]),
  group("2020-21", 2020, [
    { role: "President", name: "Dillan Maloney" },
    { role: "Vice-President", name: "Emily Hannan" },
  ]),
];

describe("PastOfficers", () => {
  it("renders the empty state when the archive is empty", () => {
    const { container } = render(<PastOfficers groups={[]} />);
    expect(container).toHaveTextContent(/being assembled/i);
  });

  it("defaults to the most recent year and hides the rest", () => {
    render(<PastOfficers groups={GROUPS} />);

    // Most recent (first in the DESC-sorted input) is the default.
    expect(
      screen.getByRole("heading", { name: "2022-23" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "2021-22" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "2020-21" }),
    ).not.toBeInTheDocument();

    // The 2022-23 officers are visible.
    expect(
      screen.getByText("Deyer Graffice & Alyssa Polito"),
    ).toBeInTheDocument();
    expect(screen.getByText("Trevor Darst")).toBeInTheDocument();
    // Other years' officers are not in the DOM at all.
    expect(screen.queryByText("Rob Olszewski")).not.toBeInTheDocument();
    expect(screen.queryByText("Dillan Maloney")).not.toBeInTheDocument();
  });

  it("switches to a specific year when the user picks it from the dropdown", async () => {
    const user = userEvent.setup();
    render(<PastOfficers groups={GROUPS} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "2020-21" }));

    expect(
      screen.getByRole("heading", { name: "2020-21" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dillan Maloney")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "2022-23" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Trevor Darst")).not.toBeInTheDocument();
  });

  it("renders every year when 'All years' is selected", async () => {
    const user = userEvent.setup();
    render(<PastOfficers groups={GROUPS} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(
      screen.getByRole("option", { name: /All years \(3 total\)/ }),
    );

    expect(
      screen.getByRole("heading", { name: "2022-23" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "2021-22" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "2020-21" }),
    ).toBeInTheDocument();
  });

  it("lists every archived year in the dropdown options", async () => {
    const user = userEvent.setup();
    render(<PastOfficers groups={GROUPS} />);

    await user.click(screen.getByRole("combobox"));
    const listbox = screen.getByRole("listbox");
    // 3 years + the "All years" option = 4 options total.
    expect(within(listbox).getAllByRole("option")).toHaveLength(4);
    expect(
      within(listbox).getByRole("option", { name: "2022-23" }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole("option", { name: "2021-22" }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole("option", { name: "2020-21" }),
    ).toBeInTheDocument();
  });
});
