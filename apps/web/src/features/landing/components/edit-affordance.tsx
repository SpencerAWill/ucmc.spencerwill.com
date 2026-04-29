/**
 * Pencil button + dialog wrapper for inline landing-page editing. Renders
 * `null` for users who lack `landing:edit` so the public DOM is identical
 * to what unauthenticated visitors see — no permission-gated affordances
 * leak into the static HTML.
 *
 * Usage:
 *
 *   <EditAffordance label="Edit hero">
 *     {({ close }) => <HeroEditor onSaved={close} />}
 *   </EditAffordance>
 *
 * The render-prop hands `close` to the form so it can dismiss the dialog
 * after a successful save.
 */
import { Pencil } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { useAuth } from "#/features/auth/api/use-auth";

export interface EditAffordanceProps {
  /** Visible heading inside the dialog and aria-label on the trigger. */
  label: string;
  /**
   * Optional explainer rendered under the title. Defaults to a generic
   * line; pass a section-specific string when a concrete one would help
   * (it's read aloud by screen readers).
   */
  description?: string;
  /** Render-prop receives a `close` callback to dismiss the dialog from inside the form. */
  children: (api: { close: () => void }) => ReactNode;
  /**
   * Position the trigger relative to its parent. Defaults to top-right of
   * a `relative`-positioned section.
   */
  className?: string;
}

export function EditAffordance({
  label,
  description,
  children,
  className,
}: EditAffordanceProps) {
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);

  if (!hasPermission("landing:edit")) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={label}
        onClick={() => setOpen(true)}
        className={className ?? "absolute right-4 top-4 z-20 gap-1.5 shadow-sm"}
      >
        <Pencil className="size-3.5" />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription className="sr-only">
              {description ??
                "Make changes to this section. Save to publish them on the home page."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1">
            {children({ close: () => setOpen(false) })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
