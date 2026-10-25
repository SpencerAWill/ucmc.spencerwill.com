/**
 * The `notice` category on /settings: the four rows, under a preview of
 * the bar exactly as it renders site-wide (`SiteNoticeBar`, ticker and
 * all), so an officer sees the tone and how a long notice behaves before
 * anyone else does.
 *
 * The preview is fed from the raw settings, not from the server's
 * audience decision — the person editing should see the notice whatever
 * the audience is, which is why the caption says who else will.
 */
import {
  SiteNoticeBar,
  TONE_CLASSES,
} from "#/components/layouts/site-notice-banner";
import type { SiteSettingsSnapshot } from "#/features/settings/server/settings-fns";
import { CATEGORY_LABELS, getMeta } from "#/server/settings/settings-registry";
import type { NoticeTone } from "#/server/settings/site-notice";
import { NOTICE_TONES } from "#/server/settings/site-notice";
import { SettingRow } from "./setting-row";

const NOTICE_KEYS = [
  "notice.enabled",
  "notice.text",
  "notice.audience",
  "notice.tone",
] as const;

function isTone(value: string): value is NoticeTone {
  return (NOTICE_TONES as readonly string[]).includes(value);
}

function ToneSwatch({ tone }: { tone: string }) {
  if (!isTone(tone)) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      data-testid={`tone-swatch-${tone}`}
      className={`size-3 shrink-0 rounded-full ring-1 ring-foreground/15 ${TONE_CLASSES[tone].swatch}`}
    />
  );
}

export function NoticePanel({
  entries,
}: {
  entries: SiteSettingsSnapshot | undefined;
}) {
  const enabled = entries?.["notice.enabled"]?.value ?? false;
  const text = entries?.["notice.text"]?.value.trim() ?? "";
  const tone = entries?.["notice.tone"]?.value ?? "info";
  const audience = entries?.["notice.audience"]?.value ?? "members";
  const audienceLabel =
    getMeta("notice.audience").optionLabels?.[audience] ?? audience;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{CATEGORY_LABELS.notice}</h2>

      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-xs font-medium text-muted-foreground">
          {enabled ? "Live" : "Preview (not live)"}
        </p>
        {text.length > 0 ? (
          // Not sticky here: it previews the bar, it isn't the bar.
          <SiteNoticeBar
            text={text}
            tone={tone}
            className="static rounded-md"
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Add notice text to see a preview.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Visible to: {audienceLabel.toLowerCase()}
        </p>
      </div>

      <div className="space-y-3">
        {entries === undefined ? (
          NOTICE_KEYS.map((key) => (
            <div
              key={key}
              className="h-20 animate-pulse rounded-lg border bg-muted/40"
            />
          ))
        ) : (
          <>
            {entries["notice.enabled"] ? (
              <SettingRow
                settingKey="notice.enabled"
                entry={entries["notice.enabled"]}
              />
            ) : null}
            {entries["notice.text"] ? (
              <SettingRow
                settingKey="notice.text"
                entry={entries["notice.text"]}
              />
            ) : null}
            {entries["notice.audience"] ? (
              <SettingRow
                settingKey="notice.audience"
                entry={entries["notice.audience"]}
              />
            ) : null}
            {entries["notice.tone"] ? (
              <SettingRow
                settingKey="notice.tone"
                entry={entries["notice.tone"]}
                renderOption={(value) => <ToneSwatch tone={value} />}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
