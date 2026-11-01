import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeactivatedNotice } from "#/features/conduct/components/deactivated-notice";
import { APPEAL_LINE } from "#/features/conduct/server/limits";

const HEADING = "Your membership was terminated by the Executive Committee";

describe("DeactivatedNotice", () => {
  it("shows the termination heading, the statement and the appeal text", () => {
    render(
      <DeactivatedNotice
        notice={{
          statement: "You are terminated for X.",
          appealText: APPEAL_LINE,
        }}
        terminated={false}
      />,
    );
    expect(screen.getByRole("heading", { name: HEADING })).toBeVisible();
    expect(screen.getByText("You are terminated for X.")).toBeVisible();
    expect(screen.getByText(APPEAL_LINE)).toBeVisible();
    expect(screen.queryByText(/club administrator/)).toBeNull();
  });

  it("shows the heading and appeal text without a statement for ?reason=terminated", () => {
    render(<DeactivatedNotice notice={null} terminated />);
    expect(screen.getByRole("heading", { name: HEADING })).toBeVisible();
    expect(screen.getByText(APPEAL_LINE)).toBeVisible();
    expect(screen.queryByText(/club administrator/)).toBeNull();
  });

  it("shows the generic copy otherwise", () => {
    render(<DeactivatedNotice notice={null} terminated={false} />);
    expect(
      screen.getByRole("heading", { name: "Account deactivated" }),
    ).toBeVisible();
    expect(screen.getByText(/club administrator/)).toBeVisible();
    expect(screen.queryByText(APPEAL_LINE)).toBeNull();
  });
});
