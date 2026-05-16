import { toast } from "sonner";

import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useSubmitClubFeedback } from "#/features/club-feedback/api/use-submit-club-feedback";
import {
  CLUB_FEEDBACK_KIND_HELP,
  CLUB_FEEDBACK_KIND_LABELS,
  CLUB_FEEDBACK_KIND_VALUES,
  CLUB_FEEDBACK_LIMITS,
  clubFeedbackInputSchema,
} from "#/features/club-feedback/server/limits";
import type { ClubFeedbackKind } from "#/features/club-feedback/server/limits";
import { useAppForm } from "#/lib/form/form";

interface FormValues {
  kind: ClubFeedbackKind;
  title: string;
  body: string;
  anonymous: boolean;
}

const DEFAULTS: FormValues = {
  kind: "suggestion",
  title: "",
  body: "",
  anonymous: false,
};

function validateClubFeedback({
  value,
}: {
  value: FormValues;
}): { fields: Record<string, string> } | undefined {
  const result = clubFeedbackInputSchema.safeParse(value);
  if (result.success) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in fields)) {
      fields[key] = issue.message;
    }
  }
  return { fields };
}

/**
 * Inline club-feedback form. Four equally-weighted kinds (suggestion,
 * concern, praise, general) and a single body field per kind — no
 * defect-style sub-sections, because club feedback is narrative
 * governance input, not a bug template.
 *
 * Body is a plain textarea (not `field.MarkdownField`) so the route
 * doesn't pull the ~265 KB-gz TipTap bundle for a tab a member may
 * never open.
 *
 * The anonymous checkbox is a UI-level affordance — the server still
 * stamps `createdBy` for rate limiting + abuse handling, but flips
 * `anonymous: true` so manager-side projections strip the submitter
 * from the wire payload entirely.
 */
export function ClubFeedbackForm() {
  const submitMutation = useSubmitClubFeedback();

  const form = useAppForm({
    defaultValues: DEFAULTS,
    validators: {
      onMount: validateClubFeedback,
      onChange: validateClubFeedback,
      onBlur: validateClubFeedback,
      onSubmit: validateClubFeedback,
    },
    onSubmit: ({ value, formApi }) => {
      submitMutation.mutate(value, {
        onSuccess: () => {
          toast.success("Thanks — your feedback was sent to the exec board.");
          formApi.reset();
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : "Couldn’t send your feedback. Please try again.",
          );
        },
      });
    },
  });

  return (
    <form
      className="space-y-4 rounded-md border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe
        selector={(s) => ({
          isSubmitting: s.isSubmitting,
          kind: s.values.kind,
          anonymous: s.values.anonymous,
        })}
      >
        {({ isSubmitting, kind, anonymous }) => (
          <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0">
            <Tabs
              value={kind}
              onValueChange={(v) =>
                form.setFieldValue("kind", v as ClubFeedbackKind)
              }
            >
              {/*
                Four labels can't share one row on phones without truncation
                ("Suggestion" alone needs ~85 px). A 2-col grid gives a
                clean 2×2 layout on mobile; from `sm` (640 px) on, fall
                back to a single row. Mirrors the pattern used in
                MembersTabsBar (which solves the same problem for five
                labels).
              */}
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
                {CLUB_FEEDBACK_KIND_VALUES.map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {CLUB_FEEDBACK_KIND_LABELS[value]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <p className="text-sm text-muted-foreground">
              {CLUB_FEEDBACK_KIND_HELP[kind]}
            </p>

            <form.AppField name="title">
              {(field) => (
                <field.TextField
                  label="Title"
                  placeholder="Short summary"
                  maxLength={CLUB_FEEDBACK_LIMITS.title.max}
                />
              )}
            </form.AppField>

            <form.AppField name="body">
              {(field) => (
                <field.TextArea
                  label="Details"
                  rows={8}
                  placeholder="What would you like the exec board to know?"
                  maxLength={CLUB_FEEDBACK_LIMITS.body.max}
                />
              )}
            </form.AppField>

            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3">
              <Checkbox
                id="club-feedback-anonymous"
                checked={anonymous}
                onCheckedChange={(checked) =>
                  form.setFieldValue("anonymous", checked === true)
                }
              />
              <div className="grid gap-1 leading-tight">
                <Label
                  htmlFor="club-feedback-anonymous"
                  className="cursor-pointer"
                >
                  Submit anonymously
                </Label>
                <p className="text-xs text-muted-foreground">
                  Your name won&apos;t be shown to officers in the triage view.
                  You&apos;ll still see this submission in your own list below.
                </p>
              </div>
            </div>
          </fieldset>
        )}
      </form.Subscribe>
      <div className="flex justify-end">
        <form.AppForm>
          <form.SubscribeButton label="Send to exec board" />
        </form.AppForm>
      </div>
    </form>
  );
}
