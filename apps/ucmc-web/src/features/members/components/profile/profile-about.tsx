/**
 * What a member says about themselves: their prompt answers, their
 * bio, and the disciplines they have rated themselves in.
 *
 * Prompts exist because the bio did not work. A free textarea headed
 * "Bio" is a blank page, and most members left it blank; a named
 * question with a concrete example answer is something people reply
 * to. The empty state says so rather than showing a bare dash.
 *
 * The discipline levels are **self-rated and labelled as such.** They
 * authorize nothing — the certificates that will gate lead and trad
 * gear are separate, officer-granted, and will render beside these
 * with a different treatment (#257 phase 2).
 */
import { CuratedIcon } from "#/components/curated-icon/curated-icon";
import { Card, CardContent } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import type {
  DisciplineKey,
  DisciplineLevel,
  ProfilePromptKey,
} from "#/server/member-profile/profile-prompt-registry";
import {
  DISCIPLINES,
  DISCIPLINE_LEVELS,
  DISCIPLINE_LEVEL_KEYS,
  PROFILE_PROMPTS,
} from "#/server/member-profile/profile-prompt-registry";

export function ProfilePrompts({
  prompts,
  bio,
  isSelf,
}: {
  prompts: { key: ProfilePromptKey; answer: string }[];
  bio: string | null;
  isSelf: boolean;
}) {
  const hasAnything = prompts.length > 0 || Boolean(bio);

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-sm font-semibold">About</h2>

        {prompts.length > 0 ? (
          <ul className="grid gap-3">
            {prompts.map((prompt) => (
              <li key={prompt.key} className="rounded-lg bg-muted px-3 py-2.5">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {PROFILE_PROMPTS[prompt.key].question}
                </p>
                <p className="mt-1 font-medium break-words">{prompt.answer}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {bio ? <p className="text-sm whitespace-pre-line">{bio}</p> : null}

        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">
            {isSelf
              ? "Answer a few prompts on your profile so people have something to say hello about."
              : "Nothing here yet."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProfileDisciplines({
  disciplines,
  isSelf,
}: {
  disciplines: { discipline: DisciplineKey; level: DisciplineLevel }[];
  isSelf: boolean;
}) {
  if (disciplines.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2">
          <h2 className="text-sm font-semibold">Experience</h2>
          <p className="text-sm text-muted-foreground">
            {isSelf
              ? "Rate yourself in the things you get out and do, so trip leaders know who to ask."
              : "Nothing rated yet."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const rungs = DISCIPLINE_LEVEL_KEYS.length;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Experience</h2>
          <Badge variant="outline" className="font-normal">
            Self-rated
          </Badge>
        </div>

        {/* One column at phone width: a two-up grid leaves the level
            label sharing a line with the meter and neither readable. */}
        <ul className="grid gap-2 sm:grid-cols-2">
          {disciplines.map(({ discipline, level }) => {
            const meta = DISCIPLINES[discipline];
            const levelMeta = DISCIPLINE_LEVELS[level];
            return (
              <li
                key={discipline}
                className="rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <CuratedIcon
                    name={meta.icon}
                    className="size-4 shrink-0 text-primary"
                  />
                  <span className="truncate text-sm font-semibold">
                    {meta.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {levelMeta.label}
                </p>
                <div
                  className="mt-1.5 flex gap-1"
                  role="img"
                  aria-label={`${levelMeta.label}: ${levelMeta.description}`}
                >
                  {DISCIPLINE_LEVEL_KEYS.map((rung, i) => (
                    <span
                      key={rung}
                      className={
                        i < levelMeta.rank
                          ? "h-1 flex-1 rounded-full bg-primary"
                          : "h-1 flex-1 rounded-full bg-muted"
                      }
                    />
                  ))}
                </div>
                <span className="sr-only">
                  {levelMeta.rank} of {rungs}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
