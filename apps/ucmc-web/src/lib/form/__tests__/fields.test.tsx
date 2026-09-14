import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidPhoneNumber } from "react-phone-number-input";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { useAppForm } from "#/lib/form/form";

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
