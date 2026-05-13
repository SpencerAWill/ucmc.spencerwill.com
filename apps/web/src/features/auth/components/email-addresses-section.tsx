import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "#/components/ui/item";
import { myEmailsQueryOptions } from "#/features/auth/api/queries";
import { useAddEmail } from "#/features/auth/api/use-add-email";
import { useRemoveEmail } from "#/features/auth/api/use-remove-email";
import { useSetPrimaryEmail } from "#/features/auth/api/use-set-primary-email";
import { useAppForm } from "#/lib/form/form";

const addEmailSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
});

/**
 * "Email addresses" section on `/my/account/details`. Lists every
 * verified address attached to the user, with a Primary badge, a
 * "Make primary" button on non-primary rows, and a "Remove" button
 * (disabled on the primary row and when only one row exists). Below
 * the list, an inline form lets the user request a verification link
 * for an additional address — the link arrives by email, the
 * recipient clicks it, and `/verify-email` attaches the row.
 *
 * Pending users (`approved={false}`) see a single read-only row for
 * their registration email with no add/remove controls. The server
 * actions also gate on `requireApproved`; the client gate is
 * cosmetic.
 */
export function EmailAddressesSection({
  approved,
  primaryEmail,
}: {
  approved: boolean;
  primaryEmail: string;
}) {
  if (!approved) {
    // Pending-user read-only view. Mirrors the approved row shape
    // (badge + dim helper line) so the visual treatment is consistent
    // across pre/post-approval — only the controls differ.
    return (
      <section className="space-y-3">
        <header>
          <h3 className="text-base font-medium">Email addresses</h3>
          <p className="text-sm text-muted-foreground">
            You can manage additional email addresses once your registration is
            approved.
          </p>
        </header>
        <ItemGroup className="gap-2">
          <Item variant="outline" size="sm">
            <ItemContent>
              <ItemTitle>
                <span className="truncate">{primaryEmail}</span>
                <Badge variant="secondary">Primary</Badge>
              </ItemTitle>
              <ItemDescription>Verified at registration</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </section>
    );
  }
  return <ApprovedEmailAddressesSection />;
}

function ApprovedEmailAddressesSection() {
  const query = useQuery(myEmailsQueryOptions());
  const removal = useRemoveEmail();
  const promote = useSetPrimaryEmail();
  const emails = query.data ?? [];
  const onlyOne = emails.length <= 1;

  return (
    <section className="space-y-3">
      <header>
        <h3 className="text-base font-medium">Email addresses</h3>
        <p className="text-sm text-muted-foreground">
          You can sign in with any verified address. The primary address is
          where we send announcements and other club mail.
        </p>
      </header>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ItemGroup className="gap-2">
          {emails.map((row) => (
            <Item key={row.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>
                  <span className="truncate">{row.email}</span>
                  {row.isPrimary ? (
                    <Badge variant="secondary">Primary</Badge>
                  ) : null}
                </ItemTitle>
                <ItemDescription>
                  {row.verifiedAt
                    ? `Verified ${new Date(row.verifiedAt).toLocaleDateString(
                        undefined,
                        { year: "numeric", month: "short", day: "numeric" },
                      )}`
                    : "Pending verification"}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {row.isPrimary ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    // `variables` holds the input of the in-flight
                    // mutation, so we only disable the row whose
                    // promotion is actually pending — clicking "Make
                    // primary" on row A doesn't grey out row B's
                    // button while A is mid-request.
                    disabled={promote.isPending && promote.variables === row.id}
                    onClick={() => {
                      promote.mutate(row.id, {
                        onSuccess: () => toast.success("Primary email updated"),
                        onError: () =>
                          toast.error("Couldn't update the primary email"),
                      });
                    }}
                  >
                    Make primary
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={
                    (removal.isPending && removal.variables === row.id) ||
                    row.isPrimary ||
                    onlyOne
                  }
                  title={
                    row.isPrimary
                      ? "Promote another email to primary first"
                      : onlyOne
                        ? "You must keep at least one email"
                        : undefined
                  }
                  onClick={() => {
                    removal.mutate(row.id, {
                      onSuccess: () => toast.success("Email removed"),
                      onError: () => toast.error("Couldn't remove the email"),
                    });
                  }}
                >
                  Remove
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}

      <AddEmailForm />
    </section>
  );
}

function AddEmailForm() {
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);
  const mutation = useAddEmail();

  const form = useAppForm({
    defaultValues: { email: "" },
    validators: {
      onMount: addEmailSchema,
      onChange: addEmailSchema,
      onBlur: addEmailSchema,
      onSubmit: addEmailSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(value.email, {
        onSuccess: (result) => {
          if (result.ok) {
            setSubmittedTo(value.email);
            return;
          }
          // Surface server-side rejections inline. The action enum maps
          // 1:1 onto user-facing copy here.
          switch (result.reason) {
            case "email_taken":
              toast.error("That email is already used by another account.");
              break;
            case "already_yours":
              toast.error("That email is already on your account.");
              break;
            case "rate_limited":
              toast.error("Too many attempts. Please wait a minute.");
              break;
            case "not_approved":
              toast.error(
                "Only approved members can add additional email addresses.",
              );
              break;
            default:
              toast.error("Couldn't send the verification link.");
          }
        },
        onError: () => {
          toast.error("Couldn't send the verification link.");
        },
      });
    },
  });

  if (submittedTo) {
    return (
      <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
        <p>
          We sent a verification link to <strong>{submittedTo}</strong>. Open it
          on this device — you must be signed in to the same account when you
          click the link.
        </p>
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setSubmittedTo(null);
            form.reset();
          }}
        >
          Add another email
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="min-w-0 flex-1">
        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label="Add an email address"
              type="email"
              placeholder="another@example.com"
              autoComplete="email"
            />
          )}
        </form.AppField>
      </div>
      <form.AppForm>
        <form.SubscribeButton label="Send verification link" />
      </form.AppForm>
    </form>
  );
}
