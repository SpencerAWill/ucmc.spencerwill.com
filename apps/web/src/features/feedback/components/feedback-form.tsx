import { toast } from "sonner";

import { useSubmitFeedback } from "#/features/feedback/api/use-submit-feedback";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KIND_VALUES,
  FEEDBACK_LIMITS,
  feedbackInputSchema,
} from "#/features/feedback/server/limits";
import type { FeedbackInput } from "#/features/feedback/server/limits";
import { useAppForm } from "#/lib/form/form";

const KIND_OPTIONS = FEEDBACK_KIND_VALUES.map((value) => ({
  value,
  label: FEEDBACK_KIND_LABELS[value],
}));

const DEFAULTS: FeedbackInput = {
  kind: "bug",
  title: "",
  body: "",
  pageUrl: "",
  userAgent: "",
};

/**
 * Inline feedback form. Lives directly on /feedback (not in a sheet) so
 * submitting feedback feels like writing a quick note rather than
 * something behind a modal. Captures the current page URL + UA from the
 * browser at submit time so admins have context when triaging bugs.
 */
export function FeedbackForm() {
  const submitMutation = useSubmitFeedback();

  const titleSchema = feedbackInputSchema.shape.title;
  const bodySchema = feedbackInputSchema.shape.body;

  const form = useAppForm({
    defaultValues: DEFAULTS,
    validators: {
      onMount: feedbackInputSchema,
      onChange: feedbackInputSchema,
      onBlur: feedbackInputSchema,
      onSubmit: feedbackInputSchema,
    },
    onSubmit: ({ value, formApi }) => {
      const enriched: FeedbackInput = {
        ...value,
        pageUrl: typeof window === "undefined" ? "" : window.location.href,
        userAgent:
          typeof navigator === "undefined"
            ? ""
            : navigator.userAgent.slice(0, FEEDBACK_LIMITS.userAgent.max),
      };
      submitMutation.mutate(enriched, {
        onSuccess: () => {
          toast.success("Thanks — your feedback was sent.");
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
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0">
            <form.AppField name="kind">
              {(field) => (
                <field.Select
                  label="Type"
                  values={KIND_OPTIONS}
                  placeholder="Pick one"
                />
              )}
            </form.AppField>
            <form.AppField
              name="title"
              validators={{ onChange: titleSchema, onBlur: titleSchema }}
            >
              {(field) => (
                <field.TextField
                  label="Title"
                  placeholder="Short summary"
                  maxLength={FEEDBACK_LIMITS.title.max}
                />
              )}
            </form.AppField>
            <form.AppField
              name="body"
              validators={{ onChange: bodySchema, onBlur: bodySchema }}
            >
              {(field) => (
                <field.TextArea
                  label="Details"
                  placeholder="What happened? What did you expect? Steps to reproduce, links, anything else useful…"
                  rows={8}
                  maxLength={FEEDBACK_LIMITS.body.max}
                />
              )}
            </form.AppField>
          </fieldset>
        )}
      </form.Subscribe>
      <div className="flex justify-end">
        <form.AppForm>
          <form.SubscribeButton label="Send feedback" />
        </form.AppForm>
      </div>
    </form>
  );
}
