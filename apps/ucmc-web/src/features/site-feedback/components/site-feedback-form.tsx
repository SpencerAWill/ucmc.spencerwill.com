import { toast } from "sonner";

import type {
  CapturedScreenshot,
  FeedbackPageContext,
} from "#/components/feedback/feedback-launcher";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useSubmitSiteFeedback } from "#/features/site-feedback/api/use-submit-site-feedback";
import {
  SITE_FEEDBACK_KIND_VALUES,
  SITE_FEEDBACK_LIMITS,
  siteFeedbackInputSchema,
} from "#/features/site-feedback/server/limits";
import type {
  SiteFeedbackInput,
  SiteFeedbackKind,
} from "#/features/site-feedback/server/limits";
import { useAppForm } from "#/lib/form/form";

// Flat shape that's a superset of every variant. The discriminated-union
// validator picks the right slice based on `kind`; unused fields are
// stripped on submit when we project to the active variant.
interface FormValues {
  kind: SiteFeedbackKind;
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
  // "auto" follows the kind (on for a bug) until the member touches the
  // checkbox; after that their choice sticks across kind changes.
  screenshotChoice: "auto" | "on" | "off";
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
  screenshotChoice: "auto",
};

function includesScreenshot(values: FormValues): boolean {
  return values.screenshotChoice === "auto"
    ? values.kind === "bug"
    : values.screenshotChoice === "on";
}

// Short labels for the tab triggers. The full labels
// (`SITE_FEEDBACK_KIND_LABELS`) stay in the admin triage card; on the
// submitter side the form's heading already says "Send feedback" so
// "Bug" / "Feature" / "General" reads cleanly and keeps three triggers
// fitting comfortably on a narrow phone viewport.
const KIND_TAB_LABELS: Record<SiteFeedbackKind, string> = {
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
  const result = siteFeedbackInputSchema.safeParse(projectToVariant(value));
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

function projectToVariant(
  values: FormValues,
  screenshot: CapturedScreenshot | null = null,
): SiteFeedbackInput {
  const base = {
    title: values.title,
    pageUrl: values.pageUrl,
    userAgent: values.userAgent,
    // Only when ticked: an unticked box uploads nothing.
    ...(screenshot !== null && includesScreenshot(values)
      ? { screenshotDataUrl: screenshot.dataUrl }
      : {}),
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
 * Site-feedback form. Bug + feature submissions follow the same
 * structure as `.github/ISSUE_TEMPLATE/bug_report.md` and
 * `feature_request.md` so submitters give us actionable info upfront;
 * general feedback stays a free-form note. The page URL and user agent
 * come from `pageContext`, recorded when the member opened the dialog,
 * so the report names the page they were on rather than wherever the
 * dialog happens to be.
 *
 * With `onSubmitted`, the caller owns the success message.
 */
export function SiteFeedbackForm({
  pageContext,
  onSubmitted,
}: {
  pageContext: FeedbackPageContext;
  onSubmitted?: () => void;
}) {
  const submitMutation = useSubmitSiteFeedback();

  const form = useAppForm({
    defaultValues: DEFAULTS,
    validators: {
      onMount: validateFeedback,
      onChange: validateFeedback,
      onSubmit: validateFeedback,
    },
    onSubmit: ({ value, formApi }) => {
      const enriched: FormValues = {
        ...value,
        pageUrl: pageContext.pageUrl,
        userAgent: pageContext.userAgent.slice(
          0,
          SITE_FEEDBACK_LIMITS.userAgent.max,
        ),
      };
      submitMutation.mutate(
        projectToVariant(enriched, pageContext.screenshot),
        {
          onSuccess: () => {
            formApi.reset();
            if (onSubmitted) {
              onSubmitted();
            } else {
              toast.success("Thanks — your feedback was sent.");
            }
          },
          onError: (err) => {
            toast.error(
              err instanceof Error
                ? err.message
                : "Couldn’t send your feedback. Please try again.",
            );
          },
        },
      );
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Read by the site maintainers.
      </p>
      <form.Subscribe
        selector={(s) => ({
          isSubmitting: s.isSubmitting,
          kind: s.values.kind,
          includeScreenshot: includesScreenshot(s.values),
        })}
      >
        {({ isSubmitting, kind, includeScreenshot }) => (
          <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0">
            <Tabs
              value={kind}
              onValueChange={(v) =>
                form.setFieldValue("kind", v as SiteFeedbackKind)
              }
            >
              <TabsList className="grid w-full grid-cols-3">
                {SITE_FEEDBACK_KIND_VALUES.map((value) => (
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
                    maxLength={SITE_FEEDBACK_LIMITS.title.max}
                  />
                )}
              </form.AppField>

              <TabsContent value="bug" className="space-y-4">
                <form.AppField name="bugDescription">
                  {(field) => (
                    <field.MarkdownField
                      label="Describe the bug"
                      placeholder="A clear and concise description of what the bug is."
                      rows={4}
                      maxLength={SITE_FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="stepsToReproduce">
                  {(field) => (
                    <field.MarkdownField
                      label="Steps to reproduce"
                      placeholder={STEPS_PLACEHOLDER}
                      rows={5}
                      maxLength={SITE_FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="expectedBehavior">
                  {(field) => (
                    <field.MarkdownField
                      label="Expected behavior"
                      placeholder="What did you expect to happen instead?"
                      rows={3}
                      maxLength={SITE_FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="additionalContext">
                  {(field) => (
                    <field.MarkdownField
                      label="Additional context (optional)"
                      placeholder="Anything else useful — related issues, environment details, etc."
                      rows={3}
                      maxLength={SITE_FEEDBACK_LIMITS.optionalSection.max}
                    />
                  )}
                </form.AppField>
              </TabsContent>

              <TabsContent value="feature" className="space-y-4">
                <form.AppField name="problem">
                  {(field) => (
                    <field.MarkdownField
                      label="Is your feature request related to a problem?"
                      placeholder="Ex. I'm always frustrated when…"
                      rows={4}
                      maxLength={SITE_FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="proposedSolution">
                  {(field) => (
                    <field.MarkdownField
                      label="Describe the solution you'd like"
                      placeholder="A clear and concise description of what you want to happen."
                      rows={4}
                      maxLength={SITE_FEEDBACK_LIMITS.section.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="alternatives">
                  {(field) => (
                    <field.MarkdownField
                      label="Alternatives considered (optional)"
                      placeholder="Other approaches you've thought about."
                      rows={3}
                      maxLength={SITE_FEEDBACK_LIMITS.optionalSection.max}
                    />
                  )}
                </form.AppField>
                <form.AppField name="additionalContext">
                  {(field) => (
                    <field.MarkdownField
                      label="Additional context (optional)"
                      placeholder="Anything else useful — links, mockups, related discussions."
                      rows={3}
                      maxLength={SITE_FEEDBACK_LIMITS.optionalSection.max}
                    />
                  )}
                </form.AppField>
              </TabsContent>

              <TabsContent value="general" className="space-y-4">
                <form.AppField name="body">
                  {(field) => (
                    <field.MarkdownField
                      label="Details"
                      placeholder="What's on your mind?"
                      rows={8}
                      maxLength={SITE_FEEDBACK_LIMITS.body.max}
                    />
                  )}
                </form.AppField>
              </TabsContent>
            </Tabs>
            {pageContext.screenshot === null ? null : (
              <ScreenshotChoice
                screenshot={pageContext.screenshot}
                checked={includeScreenshot}
                onCheckedChange={(on) =>
                  form.setFieldValue("screenshotChoice", on ? "on" : "off")
                }
              />
            )}
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

function ScreenshotChoice({
  screenshot,
  checked,
  onCheckedChange,
}: {
  screenshot: CapturedScreenshot;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="shrink-0 overflow-hidden rounded border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <img
              src={screenshot.dataUrl}
              alt="Screenshot of this page, opens full size"
              className="h-16 w-24 object-cover object-top"
            />
          </button>
        </DialogTrigger>
        <DialogContent size="5xl">
          <DialogTitle>Screenshot</DialogTitle>
          <img
            src={screenshot.dataUrl}
            alt="Screenshot of the page you were on"
            className="max-h-[75svh] w-full rounded border object-contain"
          />
        </DialogContent>
      </Dialog>
      <div className="flex items-start gap-2">
        <Checkbox
          id="site-feedback-include-screenshot"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <div className="grid gap-1 leading-tight">
          <Label
            htmlFor="site-feedback-include-screenshot"
            className="cursor-pointer"
          >
            Include screenshot
          </Label>
          <p className="text-xs text-muted-foreground">
            Visible only to you and site maintainers. Never posted publicly.
          </p>
        </div>
      </div>
    </div>
  );
}
