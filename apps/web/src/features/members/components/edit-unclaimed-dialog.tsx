/**
 * Edit one unclaimed member's placeholder name and/or primary email.
 * Officers reach this from the row-level pencil button on the
 * Unclaimed tab. Once the user has claimed the row (status="approved")
 * the server rejects edits — the user owns their own profile + email
 * from that point on.
 */
import { useEffect, useId, useState } from "react";

import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useEditUnclaimed } from "#/features/members/api/use-edit-unclaimed";
import type { UnclaimedMember } from "#/features/members/server/member-fns";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EditUnclaimedDialogProps {
  member: UnclaimedMember | null;
  onOpenChange: (open: boolean) => void;
}

export function EditUnclaimedDialog({
  member,
  onOpenChange,
}: EditUnclaimedDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editMutation = useEditUnclaimed();
  const nameId = useId();
  const emailId = useId();

  useEffect(() => {
    if (member) {
      setName(member.placeholderName);
      setEmail(member.email);
      setError(null);
    }
  }, [member]);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const canSubmit =
    !!member &&
    trimmedName.length > 0 &&
    EMAIL_RE.test(trimmedEmail) &&
    !editMutation.isPending;

  async function handleSubmit() {
    if (!member) return;
    setError(null);
    const result = await editMutation.mutateAsync({
      userId: member.userId,
      name: trimmedName,
      email: trimmedEmail.toLowerCase(),
    });
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    switch (result.error.kind) {
      case "email_taken":
        setError("That email is already in use by another account.");
        break;
      case "not_unclaimed":
        setError(
          "This member has already claimed their account; their name and email can no longer be edited here.",
        );
        break;
      case "not_found":
        setError("Member not found — they may have been deleted.");
        break;
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit unclaimed member</DialogTitle>
          <DialogDescription>
            These values are placeholders used until the member claims their
            account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@uc.edu"
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={editMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {editMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
