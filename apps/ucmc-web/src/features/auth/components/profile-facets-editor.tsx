/**
 * The `/my/profile` editor for prompt answers and self-rated
 * disciplines.
 *
 * Its own form and its own Save, beside the main profile form rather
 * than inside it — these write two other tables, and folding them
 * into the shared `ProfileFormShape` would make registration and the
 * admin sheet carry arrays they never touch.
 *
 * Plain `useState` rather than `useAppForm`: the shape is two arrays
 * of enum pairs with no per-field validation to show, so a form
 * library would add a schema round-trip and the invariant-generics
 * coupling without buying a single error message. The server
 * validates with `profileFacetsInputSchema` regardless, and the UI
 * makes the invalid states unreachable — a prompt can only be picked
 * from the ones not already used, and the Add button disappears at
 * the cap.
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CuratedIcon } from "#/components/curated-icon/curated-icon";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";
import { useSubmitProfileFacets } from "#/features/auth/api/use-submit-profile-facets";
import type {
  DisciplineKey,
  DisciplineLevel,
  ProfilePromptKey,
} from "#/server/member-profile/profile-prompt-registry";
import {
  DISCIPLINES,
  DISCIPLINE_KEYS,
  DISCIPLINE_LEVELS,
  DISCIPLINE_LEVEL_KEYS,
  MAX_ANSWERED_PROMPTS,
  PROFILE_PROMPTS,
  PROFILE_PROMPT_KEYS,
  PROMPT_ANSWER_MAX_LENGTH,
} from "#/server/member-profile/profile-prompt-registry";
import type { ProfileFacetsInput } from "#/server/profile/profile-schemas";

export interface ProfileFacetsEditorProps {
  prompts: { key: ProfilePromptKey; answer: string }[];
  disciplines: { discipline: DisciplineKey; level: DisciplineLevel }[];
}

/** `""` is "not rated", which is a real answer and not an error. */
type LevelChoice = DisciplineLevel | "";

export function ProfileFacetsEditor({
  prompts: initialPrompts,
  disciplines: initialDisciplines,
}: ProfileFacetsEditorProps) {
  const mutation = useSubmitProfileFacets();

  const [prompts, setPrompts] = useState(initialPrompts);
  const [levels, setLevels] = useState<Record<string, LevelChoice>>(() =>
    Object.fromEntries(
      initialDisciplines.map((d) => [d.discipline, d.level as LevelChoice]),
    ),
  );

  const used = new Set(prompts.map((p) => p.key));
  const available = PROFILE_PROMPT_KEYS.filter((key) => !used.has(key));

  const addPrompt = () => {
    // The button is hidden when nothing is left, so this guard is
    // belt-and-braces rather than a branch anyone reaches.
    if (available.length === 0) {
      return;
    }
    setPrompts([...prompts, { key: available[0], answer: "" }]);
  };

  const save = () => {
    const payload: ProfileFacetsInput = {
      // Blank answers are dropped rather than rejected: an empty row
      // is a member who added a prompt and changed their mind, and
      // refusing the whole save over it would be a scolding.
      prompts: prompts
        .map((p) => ({ key: p.key, answer: p.answer.trim() }))
        .filter((p) => p.answer.length > 0),
      disciplines: DISCIPLINE_KEYS.flatMap((discipline) => {
        const level = levels[discipline];
        return level ? [{ discipline, level }] : [];
      }),
    };

    mutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Profile saved");
      },
      onError: () => {
        toast.error("Couldn’t save that. Please try again.");
      },
    });
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Prompts</h2>
            <p className="text-sm text-muted-foreground">
              Answer up to {MAX_ANSWERED_PROMPTS}. They show at the top of your
              profile and give people something to say hello about.
            </p>
          </div>

          {prompts.map((prompt, i) => (
            <div
              key={prompt.key}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Label className="sr-only" htmlFor={`prompt-question-${i}`}>
                    Prompt {i + 1}
                  </Label>
                  <NativeSelect
                    id={`prompt-question-${i}`}
                    value={prompt.key}
                    onChange={(e) => {
                      const key = e.target.value as ProfilePromptKey;
                      setPrompts(
                        prompts.map((p, j) => (j === i ? { ...p, key } : p)),
                      );
                    }}
                  >
                    {/* The current key plus the unused ones: omitting
                        the current one would make the select show a
                        blank for the row it belongs to. */}
                    {[prompt.key, ...available].map((key) => (
                      <option key={key} value={key}>
                        {PROFILE_PROMPTS[key].question}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${PROFILE_PROMPTS[prompt.key].question}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => setPrompts(prompts.filter((_p, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Label className="sr-only" htmlFor={`prompt-answer-${i}`}>
                Answer
              </Label>
              <Input
                id={`prompt-answer-${i}`}
                value={prompt.answer}
                maxLength={PROMPT_ANSWER_MAX_LENGTH}
                placeholder={PROFILE_PROMPTS[prompt.key].placeholder}
                onChange={(e) =>
                  setPrompts(
                    prompts.map((p, j) =>
                      j === i ? { ...p, answer: e.target.value } : p,
                    ),
                  )
                }
              />
            </div>
          ))}

          {prompts.length < MAX_ANSWERED_PROMPTS && available.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPrompt}
            >
              <Plus className="mr-1 size-3.5" />
              Add a prompt
            </Button>
          ) : null}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Experience</h2>
            <p className="text-sm text-muted-foreground">
              Self-rated, and shown that way. Leave anything you don&rsquo;t do
              unset — this is so trip leaders know who to ask, not a
              leaderboard.
            </p>
          </div>

          {/* One column on a phone: a label, a hint and a select on
              one 390px row leaves nothing readable. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {DISCIPLINE_KEYS.map((discipline) => {
              const meta = DISCIPLINES[discipline];
              return (
                <div
                  key={discipline}
                  className="space-y-1.5 rounded-lg border border-border p-3"
                >
                  <Label
                    htmlFor={`discipline-${discipline}`}
                    className="flex items-center gap-2"
                  >
                    <CuratedIcon
                      name={meta.icon}
                      className="size-4 shrink-0 text-primary"
                    />
                    {meta.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{meta.hint}</p>
                  <NativeSelect
                    id={`discipline-${discipline}`}
                    value={levels[discipline] ?? ""}
                    onChange={(e) =>
                      setLevels({
                        ...levels,
                        [discipline]: e.target.value as LevelChoice,
                      })
                    }
                  >
                    <option value="">Not rated</option>
                    {DISCIPLINE_LEVEL_KEYS.map((level) => (
                      <option key={level} value={level}>
                        {DISCIPLINE_LEVELS[level].label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              );
            })}
          </div>
        </section>

        <Button type="button" onClick={save} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save prompts and experience"}
        </Button>
      </CardContent>
    </Card>
  );
}
