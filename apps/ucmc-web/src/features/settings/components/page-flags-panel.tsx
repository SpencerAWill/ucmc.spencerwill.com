import { ChevronRight, History, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useSettingSaver } from "#/features/settings/api/use-setting-saver";
import { SettingConfirmDialog } from "#/features/settings/components/setting-confirm-dialog";
import { SettingHistoryDialog } from "#/features/settings/components/setting-history-dialog";
import type { SiteSettingsSnapshot } from "#/features/settings/server/settings-fns";
import {
  getMeta,
  isDefault,
  isStale,
  PAGE_SETTING_KEYS,
  pageFlagKeyOf,
  pageParentOf,
  SETTINGS,
} from "#/server/settings/settings-registry";
import type {
  PageFlagKey,
  PageSettingKey,
} from "#/server/settings/settings-registry";

/**
 * The `pages` category, rendered as a compact tree instead of one bordered
 * card per setting.
 *
 * There are ~40 page flags. The generic `SettingRow` is a ~80px card with a
 * description, lifecycle badges, and a footer, which is right for a dozen
 * heterogeneous settings and unusable for forty homogeneous booleans — it's
 * several screens of scrolling to find one switch. These rows are single-line
 * and the sections collapse, so the whole category fits in roughly one screen.
 *
 * Three things do the compacting:
 *   - Sections (a flag with `parent` children) collapse to one summary row.
 *   - Standalone pages flow into a multi-column grid rather than a tall list.
 *   - The filter box narrows ~40 rows to the handful you came for.
 *
 * Switches sit on the LEFT so they align into a scannable column, the way a
 * permission checklist reads.
 *
 * Values shown here are RAW, straight from `listSiteSettingsFn` — never the
 * cascaded values from `effectivePageFlags`. A child switched on under a
 * switched-off section must keep showing as on, or switching the section back
 * on would look like it had lost the child's setting. The "off with section"
 * hint carries that distinction instead.
 */
export function PageFlagsPanel({
  entries,
}: {
  entries: SiteSettingsSnapshot | undefined;
}) {
  const [filter, setFilter] = useState("");

  // Built from the registry, so a new page flag appears here with no edit
  // to this file — same contract as the rest of the flag plumbing.
  const { sections, standalone } = useMemo(() => {
    const childrenOf = new Map<PageFlagKey, PageFlagKey[]>();
    const roots: PageFlagKey[] = [];
    for (const settingKey of PAGE_SETTING_KEYS) {
      const key = pageFlagKeyOf(settingKey);
      const parent = pageParentOf(key);
      if (parent) {
        const list = childrenOf.get(parent) ?? [];
        list.push(key);
        childrenOf.set(parent, list);
      } else {
        roots.push(key);
      }
    }
    return {
      sections: roots
        .filter((key) => childrenOf.has(key))
        .map((key) => ({ key, children: childrenOf.get(key) ?? [] })),
      standalone: roots.filter((key) => !childrenOf.has(key)),
    };
  }, []);

  const needle = filter.trim().toLowerCase();
  const matches = (key: PageFlagKey) =>
    needle.length === 0 ||
    key.toLowerCase().includes(needle) ||
    getMeta(settingKeyOf(key)).label.toLowerCase().includes(needle);

  const visibleSections = sections
    .map((section) => ({
      ...section,
      // A section stays visible when it matches itself, showing all its
      // children — searching "members" should surface the whole area.
      children: matches(section.key)
        ? section.children
        : section.children.filter(matches),
    }))
    .filter((section) => matches(section.key) || section.children.length > 0);
  const visibleStandalone = standalone.filter(matches);

  const offCount = entries
    ? PAGE_SETTING_KEYS.filter((k) => entries[k].value === false).length
    : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Pages</h2>
        <p className="text-xs text-muted-foreground">
          {PAGE_SETTING_KEYS.length} pages
          {offCount > 0 ? ` · ${offCount} off` : null}
        </p>
        <InputGroup className="ml-auto w-full sm:w-56">
          <InputGroupAddon>
            <Search className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter pages…"
            aria-label="Filter pages"
          />
        </InputGroup>
      </div>

      <p className="text-xs text-muted-foreground">
        Switching a page off hides it from the nav and makes it return 404 for
        everyone, whatever their permissions. A section switch also takes down
        every page under it.
      </p>

      {entries === undefined ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleSections.map((section) => (
            <SectionGroup
              key={section.key}
              sectionKey={section.key}
              childKeys={section.children}
              entries={entries}
              defaultOpen={needle.length > 0}
            />
          ))}

          {visibleStandalone.length > 0 ? (
            <div className="grid gap-x-4 gap-y-0.5 rounded-md border p-2 sm:grid-cols-2 xl:grid-cols-3">
              {visibleStandalone.map((key) => (
                <FlagRow key={key} flagKey={key} entries={entries} />
              ))}
            </div>
          ) : null}

          {visibleSections.length === 0 && visibleStandalone.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No pages match “{filter}”.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** One collapsible section: the master switch plus its child pages. */
function SectionGroup({
  sectionKey,
  childKeys,
  entries,
  defaultOpen,
}: {
  sectionKey: PageFlagKey;
  childKeys: PageFlagKey[];
  entries: SiteSettingsSnapshot;
  defaultOpen: boolean;
}) {
  const sectionOn = entries[settingKeyOf(sectionKey)].value !== false;
  const childrenOff = childKeys.filter(
    (key) => entries[settingKeyOf(key)].value === false,
  ).length;

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/section rounded-md border"
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <FlagRow flagKey={sectionKey} entries={entries} emphasize />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {childKeys.length} pages
            {childrenOff > 0 ? ` · ${childrenOff} off` : null}
          </span>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Show pages in ${getMeta(settingKeyOf(sectionKey)).label}`}
            >
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/section:rotate-90" />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        {/* Indent + rule so the parent relationship is visible without
            drawing an actual tree. */}
        <div className="ml-6 space-y-0.5 border-l pb-1.5 pl-3">
          {childKeys.map((key) => (
            <FlagRow
              key={key}
              flagKey={key}
              entries={entries}
              sectionOff={!sectionOn}
              sectionLabel={getMeta(settingKeyOf(sectionKey)).label}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One page's switch. Single line by construction: the description moves
 * into a tooltip on the label, and history / reset are icon buttons that
 * only appear on hover or focus.
 */
function FlagRow({
  flagKey,
  entries,
  emphasize = false,
  sectionOff = false,
  sectionLabel,
}: {
  flagKey: PageFlagKey;
  entries: SiteSettingsSnapshot;
  emphasize?: boolean;
  sectionOff?: boolean;
  sectionLabel?: string;
}) {
  const settingKey = settingKeyOf(flagKey);
  const meta = getMeta(settingKey);
  const entry = entries[settingKey];
  const value = entry.value === true;
  const saver = useSettingSaver(settingKey);
  const [historyOpen, setHistoryOpen] = useState(false);

  const isCustomized = !isDefault(settingKey, value);
  const stale = isStale(meta);
  const defaultValue = SETTINGS[settingKey].parse(undefined);

  return (
    <div className="group/row flex min-w-0 items-center gap-2 py-0.5">
      <Switch
        // Renders the canonical value, never the proposal — a `confirm`-gated
        // switch must not appear flipped before the user confirms.
        checked={value}
        disabled={saver.isPending}
        aria-label={meta.label}
        onCheckedChange={(checked) => {
          saver.requestSave(checked);
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Label
            className={[
              "min-w-0 flex-1 cursor-default truncate text-sm font-normal",
              emphasize ? "font-medium" : "",
              // Dimmed, not disabled: the raw value stays editable so you
              // can set a child up before switching its section back on.
              sectionOff ? "text-muted-foreground line-through" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {compactLabel(meta.label)}
          </Label>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {meta.description}
          {sectionOff && sectionLabel ? (
            <span className="mt-1 block font-medium">
              Currently off anyway — “{sectionLabel}” is switched off.
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>

      {stale ? (
        <Badge variant="destructive" className="shrink-0 text-[10px]">
          Stale
        </Badge>
      ) : null}
      {isCustomized ? (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          Custom
        </Badge>
      ) : null}

      <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        {isCustomized ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Reset ${meta.label} to default`}
            disabled={saver.isPending}
            onClick={() => saver.requestSave(defaultValue)}
          >
            <RotateCcw className="size-3" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Edit history for ${meta.label}`}
          onClick={() => setHistoryOpen(true)}
        >
          <History className="size-3" />
        </Button>
      </div>

      {saver.error ? (
        <span className="shrink-0 text-[11px] text-destructive">
          {saver.error}
        </span>
      ) : null}

      <SettingConfirmDialog
        meta={meta}
        pending={saver.pending}
        setPending={saver.setPending}
        persist={saver.persist}
        isPending={saver.isPending}
      />
      <SettingHistoryDialog
        settingKey={settingKey}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        label={meta.label}
      />
    </div>
  );
}

function settingKeyOf(key: PageFlagKey): PageSettingKey {
  return `pages.${key}` as PageSettingKey;
}

/**
 * Registry labels are written to stand alone in the generic row ("Members ·
 * Pending tab enabled"). In this panel the section header and the "Pages"
 * heading already supply that context, so the redundant parts are trimmed
 * to keep rows on one line at narrow widths.
 */
function compactLabel(label: string): string {
  return label
    .replace(/^.*? · /, "")
    .replace(/ enabled$/, "")
    .replace(/^(.)/, (c) => c.toUpperCase());
}
