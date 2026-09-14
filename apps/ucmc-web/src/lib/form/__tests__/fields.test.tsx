import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { useAppForm } from "#/lib/form/form";
import { isValidPhoneNumber } from "react-phone-number-input";

const schema = z.object({
  fullName: z.string().trim().min(1, "Required"),
  phone: z
    .string()
    .refine(
      (v) => v.length > 0 && isValidPhoneNumber(v),
      "Enter a valid phone number",
    ),
  bio: z.string(),
});

type Values = z.infer<typeof schema>;

function TestForm({ onSubmit }: { onSubmit: (values: Values) => void }) {
  const form = useAppForm({
    defaultValues: { fullName: "", phone: "", bio: "" },
    validators: {
      onMount: schema,
      onChange: schema,
      onBlur: schema,
      onSubmit: schema,
    },
    onSubmit: ({ value }) => onSubmit(value),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="fullName">
        {(field) => <field.TextField label="Full name" autoComplete="name" />}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => <field.PhoneField label="Phone" />}
      </form.AppField>
      <form.AppField name="bio">
        {(field) => <field.TextArea label="Bio" />}
      </form.AppField>
      <button type="submit">Save</button>
    </form>
  );
}

describe("form fields", () => {
  it("keeps text typed or autofilled before hydration", async () => {
    const onSubmit = vi.fn();
    const ui = <TestForm onSubmit={onSubmit} />;
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(ui);
    // Simulate the user (or browser autofill) filling the SSR'd inputs
    // before the JS bundle has hydrated.
    (container.querySelector("#fullName") as HTMLInputElement).value =
      "Pre Hydration";
    (container.querySelector("#phone") as HTMLInputElement).value =
      "(513) 555-1234";
    (container.querySelector("#bio") as HTMLTextAreaElement).value =
      "typed early";

    render(ui, { container, hydrate: true });
    const user = userEvent.setup();

    // Force a re-render of every field after hydration.
    await user.type(screen.getByLabelText("Bio"), "!");

    expect(screen.getByLabelText("Full name")).toHaveValue("Pre Hydration");
    expect(screen.getByLabelText("Phone")).toHaveValue("(513) 555-1234");
    expect(screen.getByLabelText("Bio")).toHaveValue("typed early!");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({
      fullName: "Pre Hydration",
      phone: "+15135551234",
      bio: "typed early!",
    });
  });

  it("does not flag a field invalid until it has been blurred", async () => {
    const user = userEvent.setup();
    render(<TestForm onSubmit={vi.fn()} />);
    const phone = screen.getByLabelText("Phone");

    await user.type(phone, "5");
    expect(phone).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.tab();
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid phone number",
    );
  });

  it("lets a soft keyboard erase the phone number past formatting punctuation", async () => {
    const user = userEvent.setup();
    render(<TestForm onSubmit={vi.fn()} />);
    const phone = screen.getByLabelText("Phone");

    await user.type(phone, "513");
    expect(phone).toHaveValue("(513)");

    // Android soft keyboards report keyCode 229 for Backspace, so the
    // keydown interception never sees a Backspace; only the resulting
    // input event arrives, with the closing paren gone.
    fireEvent.change(phone, { target: { value: "(513" } });
    // Two digits format without the paren; the point is the digit went.
    expect(phone).toHaveValue("51");
  });
});
