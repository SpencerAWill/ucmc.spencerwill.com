/**
 * The "Send feedback" dialog, opened from the user menu on any page.
 *
 * Lives in `components/layouts/` because it composes both feedback
 * features, which may not import each other; `AppLayout` mounts it once
 * inside `FeedbackLauncherProvider`. The page context (URL, user agent,
 * screenshot) was recorded by `open()` and is held by the launcher until
 * the dialog closes, so moving Club → Back → Site keeps the screenshot.
 * Only the site form receives it: club feedback can be anonymous and
 * carries nothing about the member's browser.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useFeedbackLauncherState } from "#/components/feedback/feedback-launcher";
import type { FeedbackPageContext } from "#/components/feedback/feedback-launcher";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useAuth } from "#/features/auth/api/use-auth";
import { ClubFeedbackForm } from "#/features/club-feedback/components/club-feedback-form";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import { SiteFeedbackForm } from "#/features/site-feedback/components/site-feedback-form";
import { useIsMobile } from "#/hooks/use-mobile";

type Step = "choose" | "site" | "club";

export interface FeedbackSurfaces {
  site: boolean;
  club: boolean;
}

/**
 * Which surfaces the viewer may send to right now: approved, holding the
 * submit permission (preview-aware via `hasPermission`), and with that
 * surface's submissions switched on.
 */
export function useFeedbackSurfaces(): FeedbackSurfaces {
  const { isApproved, hasPermission } = useAuth();
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  return {
    site:
      isApproved && hasPermission("site_feedback:submit") && flags.siteFeedback,
    club:
      isApproved && hasPermission("club_feedback:submit") && flags.clubFeedback,
  };
}

function initialStep(surfaces: FeedbackSurfaces): Step {
  if (surfaces.site && surfaces.club) {
    return "choose";
  }
  return surfaces.site ? "site" : "club";
}

const TITLES: Record<Step, string> = {
  choose: "Send feedback",
  site: "Site feedback",
  club: "Club feedback",
};

const DESCRIPTIONS: Record<Step, string> = {
  choose: "Who should hear about it?",
  site: "Reaches the site maintainers. Bugs, feature ideas, anything about this website.",
  club: "Reaches the exec board. Suggestions, concerns, praise about trips, meetings, gear, anything club. Can be anonymous.",
};

export function FeedbackDialog({ surfaces }: { surfaces: FeedbackSurfaces }) {
  const { isOpen, context, close } = useFeedbackLauncherState();
  const isMobile = useIsMobile();

  if (!surfaces.site && !surfaces.club) {
    return null;
  }

  const onOpenChange = (next: boolean) => {
    if (!next) {
      close();
    }
  };

  // Unmounted while closed (context is null), so each open starts from
  // the first step.
  const body =
    context === null ? null : (
      <FeedbackSteps
        surfaces={surfaces}
        context={context}
        onDone={() => {
          toast.success("Thanks — see it in My feedback");
          close();
        }}
        isMobile={isMobile}
      />
    );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[100svh] overflow-y-auto"
          data-feedback-capture-exclude
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        data-feedback-capture-exclude
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

function FeedbackSteps({
  surfaces,
  context,
  onDone,
  isMobile,
}: {
  surfaces: FeedbackSurfaces;
  context: FeedbackPageContext;
  onDone: () => void;
  isMobile: boolean;
}) {
  const [step, setStep] = useState<Step>(() => initialStep(surfaces));
  const canGoBack = surfaces.site && surfaces.club && step !== "choose";
  const Header = isMobile ? SheetHeader : DialogHeader;
  const Title = isMobile ? SheetTitle : DialogTitle;
  const Description = isMobile ? SheetDescription : DialogDescription;

  return (
    <div className="space-y-4">
      <Header>
        {canGoBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 w-fit"
            onClick={() => setStep("choose")}
          >
            <ArrowLeft className="mr-1 size-4" />
            Back
          </Button>
        ) : null}
        <Title>{TITLES[step]}</Title>
        <Description>{DESCRIPTIONS[step]}</Description>
      </Header>
      {step === "choose" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceButton
            icon={MessageSquare}
            title="Club feedback"
            description={DESCRIPTIONS.club}
            onClick={() => setStep("club")}
          />
          <ChoiceButton
            icon={Wrench}
            title="Site feedback"
            description={DESCRIPTIONS.site}
            onClick={() => setStep("site")}
          />
        </div>
      ) : step === "site" ? (
        <SiteFeedbackForm pageContext={context} onSubmitted={onDone} />
      ) : (
        <ClubFeedbackForm onSubmitted={onDone} />
      )}
    </div>
  );
}

function ChoiceButton({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-md border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}
