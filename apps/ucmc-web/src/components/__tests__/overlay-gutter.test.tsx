/**
 * A dialog must keep a gutter to the screen edge at phone width, at
 * every size, and nothing a caller passes may remove it.
 *
 * That is the whole reason `DialogContent` and `SheetContent` take a
 * `size` prop (#243): a caller's bare `max-w-lg` in `className` used to
 * *replace* the base `max-w-[calc(100%-2rem)]` under tailwind-merge, and
 * four dialogs ran edge to edge on a phone with nothing failing. ESLint
 * now bans width classes on `*Content`; this pins the other half — that
 * no size reintroduces the problem from inside the primitive.
 *
 * jsdom has no layout, so this reads the class list. The rendered
 * geometry is `e2e/reflow-overlays.spec.ts`'s job.
 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "#/components/ui/sheet";

type DialogSize = NonNullable<ComponentProps<typeof DialogContent>["size"]>;
type SheetSize = NonNullable<ComponentProps<typeof SheetContent>["size"]>;

// Keyed records rather than arrays so `satisfies` makes them exhaustive:
// a size added to the primitive without being added here is a type
// error, not a size this test silently never renders.
const DIALOG_SIZES = Object.keys({
  sm: true,
  md: true,
  lg: true,
  xl: true,
  "2xl": true,
  "4xl": true,
  "5xl": true,
} satisfies Record<DialogSize, true>) as DialogSize[];
const SHEET_SIZES = Object.keys({
  sm: true,
  md: true,
  lg: true,
  xl: true,
  "2xl": true,
  "3xl": true,
} satisfies Record<SheetSize, true>) as SheetSize[];

/** Width utilities that apply below `sm`, i.e. on a phone. */
const UNPREFIXED_WIDTH = /(?:^|\s)!?(?:max-w|w)-(?!\[calc\(100%-2rem\)\])\S+/g;

describe("DialogContent", () => {
  it.each(DIALOG_SIZES)("keeps the phone gutter at size %s", (size) => {
    render(
      <Dialog open>
        <DialogContent size={size} aria-describedby={undefined}>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const classes = screen.getByRole("dialog").className;
    expect(classes).toContain("max-w-[calc(100%-2rem)]");
    // `w-full` is the one phone-width utility allowed: the gutter caps it.
    expect(
      (classes.match(UNPREFIXED_WIDTH) ?? []).map((c) => c.trim()),
    ).toEqual(["w-full"]);
    expect(classes).toContain(`sm:max-w-${size}`);
  });
});

describe("SheetContent", () => {
  it.each(SHEET_SIZES)(
    "is full width on a phone and capped from sm up at size %s",
    (size) => {
      render(
        <Sheet open>
          <SheetContent size={size} aria-describedby={undefined}>
            <SheetTitle>Title</SheetTitle>
          </SheetContent>
        </Sheet>,
      );

      const classes = screen.getByRole("dialog").className;
      expect(
        (classes.match(UNPREFIXED_WIDTH) ?? []).map((c) => c.trim()),
      ).toEqual(["w-full"]);
      expect(classes).toContain(`sm:max-w-${size}`);
    },
  );

  it("ignores size for a bottom sheet, which spans the viewport", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" size="xl" aria-describedby={undefined}>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog").className).not.toMatch(/max-w-/);
  });
});
