import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestVolunteers } from "#/features/volunteer/components/request-volunteers";

describe("<RequestVolunteers />", () => {
  it("offers a pre-loaded mail draft when the club email is set", () => {
    render(<RequestVolunteers clubEmail="club@example.com" />);
    const link = screen.getByRole("link", { name: /request volunteers/i });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:club@example.com"),
    );
  });

  it("renders nothing at all when the club email setting is blank", () => {
    // Blank means "no such address" the way the social URL settings do.
    // A button with href="" would resolve as a same-origin reload.
    const { container } = render(<RequestVolunteers clubEmail="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the setting hasn't loaded yet", () => {
    const { container } = render(<RequestVolunteers />);
    expect(container).toBeEmptyDOMElement();
  });
});
