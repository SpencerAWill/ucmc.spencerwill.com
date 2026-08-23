import { ChevronRight, Info, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "#/components/ui/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { useSettingSaver } from "#/features/settings/api/use-setting-saver";
import { SettingConfirmDialog } from "#/features/settings/components/setting-confirm-dialog";
import { SettingHistoryDialog } from "#/features/settings/components/setting-history-dialog";
import type {
  SiteSettingEntry,
  SiteSettingsSnapshot,
} from "#/features/settings/server/settings-fns";
import { formatRelative } from "#/lib/date-format";
import {
  getMeta,
  isDefault,
  isStale,
  PAGE_SETTING_KEYS,
  pageAncestorsOf,
  pageFlagKeyOf,
  pageParentOf,
  SETTINGS,
} from "#/server/settings/settings-registry";
import type {
  PageFlagKey,
  PageSettingKey,
  SettingMeta,
} from "#/server/settings/settings-registry";

/**
 * The `pages` category, rendered as a single-column tree instead of one
 * bordered card per setting.
 *
 * There are ~45 page flags. The generic `SettingRow` is an ~80px card with a
 * description, lifecycle badges, and a footer — right for a dozen
 * heterogeneous settings, unusable for forty-odd homogeneous booleans, where
 * finding one switch meant several screens of scrolling.
 *
 * Structure mirrors the URL tree, because that is what the flags describe:
 * `/members`, `/gear`, `/feedback`, and `/my` are sections whose children
 * collapse underneath them, nested to whatever depth the registry declares
 * (`/gear/loans/$id` under `/gear/loans` under `/gear`). Every page is one
 * line, so a collapsed tree is short enough to take in at once.
 *
 * Deliberately ONE column, not a grid: a page's meaning comes from its
 * position in the tree, and columns break the parent-to-child reading order
 * that carries it.
 *
 * Values here are RAW, straight from `listSiteSettingsFn` — never the
 * cascaded values from `effectivePageFlags`. A child switched on under a
 * switched-off section must keep showing as on, or switching the section
 * back on would look like it had lost the child's setting. The struck-through
 * treatment carries "off anyway" instead.
 */
export function PageFlagsPanel({
  entries,
}: {
  entries: SiteSettingsSnapshot | undefined;
}) {
  const [filter, setFilter] = useState("");
  const tree = usePageFlagTree();

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (needle.length === 0) {
      return tree;
    }
    return tree
      .map((node) => pruneToMatches(node, needle))
      .filter((node): node is PageNode => node !== null);
  }, [tree, needle]);

  const offCount = entries
    ? PAGE_SETTING_KEYS.filter((key) => entries[key].value === false).length
    : 0;
  // Pages that are on themselves but dark because an ancestor is off. Worth
  // stating separately: the raw off-count alone makes a switched-off section
  // look like only one page is hidden.
  const inheritedOff = entries ? countInheritedOff(entries) : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-lg font-semibold">Pages</h2>
        <p className="text-xs text-muted-foreground">
          {PAGE_SETTING_KEYS.length} pages
          {offCount > 0 ? ` · ${offCount} off` : null}
          {inheritedOff > 0 ? ` · ${inheritedOff} off with a section` : null}
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
        everyone, whatever their permissions. A section takes down every page
        under it. Hover or focus the info button on any row for its description
        and history.
      </p>

      {entries === undefined ? (
        <div className="space-y-1 rounded-md border p-2">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No pages match “{filter}”.
        </p>
      ) : (
        <div className="rounded-md border p-1">
          {visible.map((node) => (
            <PageNodeRow
              key={node.key}
              node={node}
              entries={entries}
              depth={0}
              ancestorOff={false}
              forceOpen={needle.length > 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── tree shape ──────────────────────────────────────────────────────────

interface PageNode {
  key: PageFlagKey;
  children: PageNode[];
}

/**
 * Build the flag tree from declared `parent` metadata. Derived from
 * `PAGE_SETTING_KEYS`, so a new page appears here with no edit to this file
 * — the same contract the rest of the flag plumbing has.
 */
function usePageFlagTree(): PageNode[] {
  return useMemo(() => {
    const nodes = new Map<PageFlagKey, PageNode>();
    for (const settingKey of PAGE_SETTING_KEYS) {
      const key = pageFlagKeyOf(settingKey);
      nodes.set(key, { key, children: [] });
    }
    const roots: PageNode[] = [];
    for (const node of nodes.values()) {
      const parent = pageParentOf(node.key);
      const parentNode = parent ? nodes.get(parent) : undefined;
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    }
    // Sections first, then standalone pages. Registry order is preserved
    // within each group, so related pages stay adjacent.
    return [
      ...roots.filter((node) => node.children.length > 0),
      ...roots.filter((node) => node.children.length === 0),
    ];
  }, []);
}

/** Keep a node when it matches, or when any descendant does. */
function pruneToMatches(node: PageNode, needle: string): PageNode | null {
  const self = matchesNeedle(node.key, needle);
  // A matching section shows all its children — filtering "gear" should
  // surface the whole area, not only the row whose label says "Gear".
  const children = self
    ? node.children
    : node.children
        .map((child) => pruneToMatches(child, needle))
        .filter((child): child is PageNode => child !== null);
  if (!self && children.length === 0) {
    return null;
  }
  return { key: node.key, children };
}

function matchesNeedle(key: PageFlagKey, needle: string): boolean {
  return (
    key.toLowerCase().includes(needle) ||
    getMeta(settingKeyOf(key)).label.toLowerCase().includes(needle)
  );
}

function countInheritedOff(entries: SiteSettingsSnapshot): number {
  return PAGE_SETTING_KEYS.filter((settingKey) => {
    if (entries[settingKey].value === false) {
      return false;
    }
    // `pageAncestorsOf` owns the walk (and its cycle bound) — don't loop
    // on `pageParentOf` here, or a mis-declared cycle hangs this render,
    // which is the one screen that could fix the bad flag.
    return pageAncestorsOf(pageFlagKeyOf(settingKey)).some(
      (ancestor) => entries[settingKeyOf(ancestor)].value === false,
    );
  }).length;
}

// ── rows ────────────────────────────────────────────────────────────────

function PageNodeRow({
  node,
  entries,
  depth,
  ancestorOff,
  forceOpen,
}: {
  node: PageNode;
  entries: SiteSettingsSnapshot;
  depth: number;
  ancestorOff: boolean;
  forceOpen: boolean;
}) {
  const isSection = node.children.length > 0;
  const own = entries[settingKeyOf(node.key)].value === true;
  const [userOpen, setUserOpen] = useState(false);

  const row = (
    <FlagRow
      flagKey={node.key}
      entries={entries}
      depth={depth}
      isSection={isSection}
      offAnyway={ancestorOff}
      trailing={
        isSection ? <SubtreeSummary node={node} entries={entries} /> : null
      }
    />
  );

  if (!isSection) {
    return row;
  }

  return (
    // Controlled, not `defaultOpen` — `defaultOpen` is read once at mount
    // (Radix seeds `useState` with it), and these rows stay mounted while
    // the filter changes. So a section that mounted collapsed would stay
    // collapsed when a filter narrowed the tree to one of its children,
    // hiding the very row being searched for. `forceOpen` therefore has to
    // override the user's toggle for as long as a filter is active.
    <Collapsible
      open={forceOpen || userOpen}
      onOpenChange={setUserOpen}
      className="group/section"
    >
      <div className="flex items-center">
        <div className="min-w-0 flex-1">{row}</div>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-1 size-6 shrink-0"
            aria-label={`Show pages in ${getMeta(settingKeyOf(node.key)).label}`}
          >
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/section:rotate-90" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        {node.children.map((child) => (
          <PageNodeRow
            key={child.key}
            node={child}
            entries={entries}
            depth={depth + 1}
            // A child is dark when any ancestor is off — this node included.
            ancestorOff={ancestorOff || !own}
            forceOpen={forceOpen}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** "7 pages · 2 off" on a section header. Counts the whole subtree. */
function SubtreeSummary({
  node,
  entries,
}: {
  node: PageNode;
  entries: SiteSettingsSnapshot;
}) {
  const descendants: PageFlagKey[] = [];
  const walk = (current: PageNode) => {
    for (const child of current.children) {
      descendants.push(child.key);
      walk(child);
    }
  };
  walk(node);
  const off = descendants.filter(
    (key) => entries[settingKeyOf(key)].value === false,
  ).length;
  return (
    <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
      {descendants.length} {descendants.length === 1 ? "page" : "pages"}
      {off > 0 ? ` · ${off} off` : null}
    </span>
  );
}

/**
 * One page's switch. Single line by construction: the description and every
 * other scrap of registry metadata move into the info popover, and reset only
 * appears once the value differs from the default.
 */
function FlagRow({
  flagKey,
  entries,
  depth,
  isSection,
  offAnyway,
  trailing,
}: {
  flagKey: PageFlagKey;
  entries: SiteSettingsSnapshot;
  depth: number;
  isSection: boolean;
  offAnyway: boolean;
  trailing: React.ReactNode;
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
    <div
      className="group/row flex min-w-0 items-center gap-2 rounded py-1 pr-1 hover:bg-muted/40"
      // Indent by nesting depth. Inline because depth is data-driven, and
      // Tailwind can't purge arbitrary values out of a computed class string.
      style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
    >
      <Switch
        // Renders the canonical value, never the proposal — a `confirm`-gated
        // switch must not appear flipped before the user confirms.
        checked={value}
        disabled={saver.isPending}
        aria-label={meta.label}
        onCheckedChange={(checked) => saver.requestSave(checked)}
      />
      <Label
        className={[
          "min-w-0 flex-1 cursor-default truncate text-sm",
          isSection ? "font-medium" : "font-normal",
          // Dimmed, not disabled: the raw value stays editable so a child can
          // be set up before its section comes back on.
          offAnyway ? "text-muted-foreground line-through" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {compactLabel(meta.label)}
      </Label>

      <FlagInfo
        flagKey={flagKey}
        meta={meta}
        entry={entry}
        defaultValue={defaultValue}
        isCustomized={isCustomized}
        stale={stale}
        offAnyway={offAnyway}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {stale ? (
        <Badge variant="destructive" className="shrink-0 text-[10px]">
          Stale
        </Badge>
      ) : null}

      {isCustomized ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
          aria-label={`Reset ${meta.label} to default`}
          disabled={saver.isPending}
          onClick={() => saver.requestSave(defaultValue)}
        >
          <RotateCcw className="size-3" />
        </Button>
      ) : null}

      {trailing}

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

/**
 * The info popover: everything the compact row can't show inline.
 *
 * A HoverCard rather than a Tooltip because the content is structured (a
 * definition list plus a button), and a tooltip is the wrong role for
 * anything interactive. The trigger is a real button so it's keyboard- and
 * touch-reachable — HoverCard opens on focus as well as hover, and a bare
 * icon would leave this metadata unreachable without a mouse.
 */
function FlagInfo({
  flagKey,
  meta,
  entry,
  defaultValue,
  isCustomized,
  stale,
  offAnyway,
  onOpenHistory,
}: {
  flagKey: PageFlagKey;
  meta: SettingMeta;
  entry: SiteSettingEntry<PageSettingKey>;
  defaultValue: boolean;
  isCustomized: boolean;
  stale: boolean;
  offAnyway: boolean;
  onOpenHistory: () => void;
}) {
  const parent = pageParentOf(flagKey);
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          aria-label={`About ${meta.label}`}
        >
          <Info className="size-3.5" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 space-y-2 text-xs">
        <div className="space-y-1">
          <p className="text-sm leading-tight font-medium">{meta.label}</p>
          <code className="text-[11px] text-muted-foreground">
            pages.{flagKey}
          </code>
        </div>
        <p className="text-muted-foreground">{meta.description}</p>

        {offAnyway && parent ? (
          <p className="rounded border border-dashed px-2 py-1.5 font-medium">
            Off right now regardless: “
            {compactLabel(getMeta(settingKeyOf(parent)).label)}” is switched
            off. This switch keeps its value and applies again when the section
            comes back on.
          </p>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
          <dt>Default</dt>
          <dd className="text-foreground">{defaultValue ? "On" : "Off"}</dd>
          {isCustomized ? (
            <>
              <dt>Now</dt>
              <dd className="text-foreground">Changed from the default</dd>
            </>
          ) : null}
          {parent ? (
            <>
              <dt>Section</dt>
              <dd className="text-foreground">
                {compactLabel(getMeta(settingKeyOf(parent)).label)}
              </dd>
            </>
          ) : null}
          {meta.flagKind ? (
            <>
              <dt>Kind</dt>
              <dd className="text-foreground uppercase">{meta.flagKind}</dd>
            </>
          ) : null}
          {meta.owner ? (
            <>
              <dt>Owner</dt>
              <dd className="text-foreground">{meta.owner}</dd>
            </>
          ) : null}
          {meta.createdAt ? (
            <>
              <dt>Added</dt>
              <dd className="text-foreground">{meta.createdAt}</dd>
            </>
          ) : null}
          {meta.expiresAt ? (
            <>
              <dt>Review by</dt>
              <dd className={stale ? "text-destructive" : "text-foreground"}>
                {meta.expiresAt}
                {stale ? " — overdue" : null}
              </dd>
            </>
          ) : null}
          {entry.updatedAtMs !== null ? (
            <>
              <dt>Edited</dt>
              <dd className="text-foreground">
                {formatRelative(
                  Temporal.Instant.fromEpochMilliseconds(entry.updatedAtMs),
                )}{" "}
                by {entry.updatedByName ?? "an officer"}
              </dd>
            </>
          ) : null}
        </dl>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={onOpenHistory}
        >
          Edit history
        </Button>
      </HoverCardContent>
    </HoverCard>
  );
}

function settingKeyOf(key: PageFlagKey): PageSettingKey {
  return `pages.${key}` as PageSettingKey;
}

/**
 * Registry labels are written to stand alone in the generic settings row
 * ("Members · Pending tab enabled"). In the tree, position already supplies
 * that context, so the redundant halves are trimmed to keep rows on one line.
 */
function compactLabel(label: string): string {
  const trimmed = label.replace(/^.*? · /, "").replace(/ enabled$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
