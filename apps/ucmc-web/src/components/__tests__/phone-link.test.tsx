import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PhoneLink } from "#/components/phone-link";

describe("<PhoneLink />", () => {
  it("renders a click-to-call link with formatted text", () => {
    render(<PhoneLink phone="+15135551234" />);
    const link = screen.getByRole("link", { name: "(513) 555-1234" });
    expect(link).toHaveAttribute("href", "tel:+15135551234");
  });

  it("renders plain text, not a link, for an undialable number", () => {
    // An <a> without an href isn't interactive but still reads as a
    // link; the branch exists so those values degrade to a span.
    render(<PhoneLink phone="5135551234" />);
    expect(screen.getByText("5135551234")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the fallback when there's no number on file", () => {
    render(<PhoneLink phone={null} fallback={<em>None on file</em>} />);
    expect(screen.getByText("None on file")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
