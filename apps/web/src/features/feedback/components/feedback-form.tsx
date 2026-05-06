import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useSubmitFeedback } from "#/features/feedback/api/use-submit-feedback";
import {
  FEEDBACK_KIND_VALUES,
  FEEDBACK_LIMITS,
  feedbackInputSchema,
} from "#/features/feedback/server/limits";
import type {
  FeedbackInput,
  FeedbackKind,
} from "#/features/feedback/server/limits";
import { useAppForm } from "#/lib/form/form";

// Flat shape that's a superset of every variant. The discriminated-union
// validator picks the right slice based on `kind`; unused fields are
// stripped on submit when we project to the active variant.
interface FormValues {
  kind: FeedbackKind;
  title: string;
  // bug
  bugDescription: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  // feature
  problem: string;
  proposedSolution: string;
  alternatives: string;
  // shared optional
  additionalContext: string;
  // general
  body: string;
  // auto-captured
  pageUrl: string;
  userAgent: string;
}

const DEFAULTS: FormValues = {
  kind: "bug",
  title: "",
  bugDescription: "",
  stepsToReproduce: "",
  expectedBehavior: "",
  problem: "",
  proposedSolution: "",
  alternatives: "",
  additionalContext: "",
  body: "",
  pageUrl: "",
  userAgent: "",
};

// Short labels for the tab triggers. The full labels
// (`FEEDBACK_KIND_LABELS`) stay in the admin triage card; on the
// submitter side the form's heading already says "Send feedback" so
// "Bug" / "Feature" / "General" reads cleanly and keeps three triggers
// fitting comfortably on a narrow phone viewport.
const KIND_TAB_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug",
  feature: "Feature",
  general: "General",
};

const STEPS_PLACEHOLDER = `1. Go to '...'
2. Click on '...'
3. See error`;

// Validate against the discriminated-union schema by first projecting
// the flat form shape down to the variant for the selected kind. The
// returned shape matches TanStack Form's structured-error contract:
// `{ fields: Record<fieldName, message> }`. Field names round-trip
// cleanly because the variant uses the same property names as the flat
// form (only the *set* of required fields differs by kind).
function validateFeedback({
  value,
}: {
  value: FormValues;
}): { fields: Record<string, string> } | undefined {
  const result = feedbackInputSchema.safeParse(projectToVariant(value));
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

function projectToVariant(values: FormValues): FeedbackInput {
  const base = {
    title: values.title,
    pageUrl: values.pageUrl,
    userAgent: values.userAgent,
  };
  if (values.kind === "bug") {
    return {
      kind: "bug",
      ...base,
      bugDescription: values.bugDescription,
      stepsToReproduce: values.stepsToReproduce,
      expectedBehavior: values.expectedBehavior,
      additionalContext: values.additionalContext,
    };
  }
  if (values.kind === "feature") {
    return {
      kind: "feature",
      ...base,
      problem: values.problem,
      proposedSolution: values.proposedSolution,
      alternatives: values.alternatives,
      additionalContext: values.additionalContext,
    };
  }
  return { kind: "general", ...base, body: values.body };
}

/**
 * Inline feedback form. Bug + feature submissions follow the same
 * structure as `.github/ISSUE_TEMPLATE/bug_report.md` and
 * `feature_request.md` so submitters give us actionable info upfront;
 * general feedback stays a free-form note. Captures the current page
 * URL + UA at submit time so admins have context when triaging.
 */
export function FeedbackForm() {
  const submitMutation = useSubmitFeedback();

  const form = useAppForm({
    defaultValues: DEFAULTS,
    validators: {
      onMount: validateFeedback,
      onChange: validateFeedback,
      onBlur: validateFeedback,
      onSubmit: validateFeedback,
    },
    onSubmit: ({ value, formApi }) => {
      const enriched: FormValues = {
        ...value,
        pageUrl: typeof window === "undefined" ? "" : window.location.href,
        userAgent:
          typeof navigator === "undefined"
            ? ""
            : navigator.userAgent.slice(0, FEEDBACK_LIMITS.userAgent.max),
      };
      submitMutation.mutate(projectToVariant(enriched), {
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
      <form.Subscribe
        selector={(s) => ({
          isSubmitting: s.isSubmitting,
          kind: s.values.kind,
        })}
      >
        {({ isSubmitting, kind }) => (
          <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0">
            <Tabs
              value={kind}
              onValueChange={(v) =>
                form.setFieldValue("kind", v as FeedbackKind)
              }
            >
              <TabsList className="grid w-full grid-cols-3">
                {FEEDBACK_KIND_VALUES.map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {KIND_TAB_LABELS[value]}
                  </TabsTrigger>
                ))}
              </TabsList>

              <form.AppField name="title">
                {(field) => (
                  <field.TextField
                    label="Title"
                    placeholder="Short summary"
                    maxLength={FEEDBACK_LIMITS.title.max}
                  />
                )}
              </form.AppField>

              <TabsContent value="bug" className="space-y-4">
                <form.AppField name="bugDescription">
                  {(field) => (
                    <field.TextArea
                      label="Describe the bug"
                      placeholder="A clear and concise description of what the bug is."
                      rows={4}
                      maxLength={FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="stepsToReproduce">
                  {(field) => (
                    <field.TextArea
                      label="Steps to reproduce"
                      placeholder={STEPS_PLACEHOLDER}
                      rows={5}
                      maxLength={FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="expectedBehavior">
                  {(field) => (
                    <field.TextArea
                      label="Expected behavior"
                      placeholder="What did you expect to happen instead?"
                      rows={3}
                      maxLength={FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="additionalContext">
                  {(field) => (
                    <field.TextArea
                      label="Additional context (optional)"
                      placeholder="Anything else useful — related issues, environment details, etc."
                      rows={3}
                      maxLength={FEEDBACK_LIMITS.optionalSection.max}
                    />
                  )}
                </form.AppField>
              </TabsContent>

              <TabsContent value="feature" className="space-y-4">
                <form.AppField name="problem">
                  {(field) => (
                    <field.TextArea
                      label="Is your feature request related to a problem?"
                      placeholder="Ex. I'm always frustrated when…"
                      rows={4}
                      maxLength={FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="proposedSolution">
                  {(field) => (
                    <field.TextArea
                      label="Describe the solution you'd like"
                      placeholder="A clear and concise description of what you want to happen."
                      rows={4}
                      maxLength={FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="alternatives">
                  {(field) => (
                    <field.TextArea
                      label="Alternatives considered (optional)"
                      placeholder="Other approaches you've thought about."
                      rows={3}
                      maxLength={FEEDBACK_LIMITS.optionalSection.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="additionalContext">
                  {(field) => (
                    <field.TextArea
                      label="Additional context (optional)"
                      placeholder="Anything else useful — links, mockups, related discussions."
                      rows={3}
                      maxLength={FEEDBACK_LIMITS.optionalSection.max}
                    />
                  )}
                </form.AppField>
              </TabsContent>

              <TabsContent value="general" className="space-y-4">
                <form.AppField name="body">
                  {(field) => (
                    <field.TextArea
                      label="Details"
                      placeholder="What's on your mind?"
                      rows={8}
                      maxLength={FEEDBACK_LIMITS.body.max}
                    />
                  )}
                </form.AppField>
              </TabsContent>
            </Tabs>
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
