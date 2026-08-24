import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useCreateRole } from "#/features/members/api/use-create-role";

const roleNameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(60, "At most 60 characters")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Lowercase letters, digits, and underscores only; must start with a letter",
  );

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(80, "At most 80 characters");

/**
 * Create-role dialog with its own trigger button, so the /access route
 * can sit it on the page-header row (matching /gear) without owning
 * the dialog's open state or reaching into the roles list. Extracted
 * from `roles-list-editor.tsx` when the button moved out of the list.
 */
export function CreateRoleDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [isOfficer, setIsOfficer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useCreateRole();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsedName = roleNameSchema.safeParse(name);
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    const parsedDisplay = displayNameSchema.safeParse(displayName);
    if (!parsedDisplay.success) {
      setError(
        parsedDisplay.error.issues[0]?.message ?? "Invalid display name",
      );
      return;
    }
    setError(null);
    mutation.mutate(
      {
        name: parsedName.data,
        displayName: parsedDisplay.data,
        description: description.trim() || undefined,
        isOfficer,
      },
      {
        onSuccess: () => {
          setName("");
          setDisplayName("");
          setDescription("");
          setIsOfficer(false);
          setError(null);
          setOpen(false);
        },
        onError: (err: Error) => {
          setError(err.message);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setError(null);
        }
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          <span className="hidden sm:inline">Create role</span>
          <span className="sm:hidden">New</span>
        </Button>
      </DialogTrigger>
      <DialogContent onKeyDown={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Add a new role. You can assign permissions to it after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-display-name">Display name</Label>
              <Input
                id="role-display-name"
                placeholder="e.g. Trip Leader"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground">
                Shown wherever this role is presented to members.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-name">Identifier</Label>
              <Input
                id="role-name"
                placeholder="e.g. trip_leader"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, and underscores. Cannot be changed
                after creation.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description (optional)</Label>
              <Textarea
                id="role-desc"
                placeholder="What this role is for…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                rows={2}
              />
            </div>
            <label
              htmlFor="role-is-officer"
              className="flex items-start gap-3 rounded-md border px-3 py-2"
            >
              <Checkbox
                id="role-is-officer"
                checked={isOfficer}
                onCheckedChange={(checked) => setIsOfficer(checked === true)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Officer position</span>
                <p className="text-xs text-muted-foreground">
                  Show members holding this role on the public &ldquo;Meet the
                  officers&rdquo; section of the home page.
                </p>
              </div>
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
