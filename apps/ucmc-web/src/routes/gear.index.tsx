import { createFileRoute } from "@tanstack/react-router";
import {
  Boxes,
  ChevronDown,
  ClipboardCheck,
  Lock,
  Package,
  Plus,
  SlidersHorizontal,
  Tags,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { PageContainer } from "#/components/layouts/page-container";
import { Button } from "#/components/ui/button";
import { useGearBulkActions } from "#/features/gear/components/gear-bulk-actions";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "#/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useAuth } from "#/features/auth/api/use-auth";
import { GearBulkImportSheet } from "#/features/gear/components/gear-bulk-import-sheet";
import { GearToolbar } from "#/features/gear/components/gear-toolbar";
import type { GearToolbarState } from "#/features/gear/components/gear-toolbar";
import { GearFormSheet } from "#/features/gear/components/gear-form-sheet";
import type { GearFormMode } from "#/features/gear/components/gear-form-sheet";
import { GearList } from "#/features/gear/components/gear-list";
import { GearRetireDialog } from "#/features/gear/components/gear-retire-dialog";
import { GearAttributesManageDialog } from "#/features/gear/components/gear-attributes-manage-dialog";
import { GearSweepSheet } from "#/features/gear/components/gear-sweep-sheet";
import { GearHoldsManageDialog } from "#/features/gear/components/gear-holds-manage-dialog";
import { GearModelsManageDialog } from "#/features/gear/components/gear-models-manage-dialog";
import { GearTagsManageDialog } from "#/features/gear/components/gear-tags-manage-dialog";
import { GearTypesManageDialog } from "#/features/gear/components/gear-types-manage-dialog";
import { useReactivateGear } from "#/features/gear/api/use-reactivate-gear";
import { useToolbarSearchState } from "#/hooks/use-toolbar-search-state";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import {
  GEAR_CONDITION_VALUES,
  GEAR_STATUS_VALUES,
} from "#/features/gear/server/gear-fns";
import { GEAR_AVAILABILITY } from "#/features/gear/lib/availability";
import {
  parseAttributeSearchParams,
  toAttributeFacets,
  toAttributeSearchParams,
} from "#/features/gear/lib/attributes";
import type { GearSummary } from "#/features/gear/server/gear-fns";

const SORT_VALUES = ["code", "created_at", "updated_at"] as const;
const DIR_VALUES = ["asc", "desc"] as const;
const VIEW_VALUES = ["list", "grid", "table"] as const;

const searchSchema = z.object({
  type: z.string().optional(),
  tag: z.array(z.string()).optional(),
  // Facet selections, one repeated param per chosen value:
  // `attr=<defPublicId>:<value>`. Flat and repeated because that is
  // what survives a copied link and a browser Back without a codec.
  attr: z.array(z.string()).optional(),
  status: z.enum(GEAR_STATUS_VALUES).optional(),
  availability: z.enum(GEAR_AVAILABILITY).optional(),
  condition: z.enum(GEAR_CONDITION_VALUES).optional(),
  q: z.string().optional(),
  sort: z.enum(SORT_VALUES).optional(),
  dir: z.enum(DIR_VALUES).optional(),
  view: z.enum(VIEW_VALUES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(250).optional(),
});

/** Resolved on read, omitted on write — see `useToolbarSearchState`.
 *  `dir` is absent on purpose: its default depends on which key you're
 *  sorting by, so it can't be a single constant. */
const SEARCH_DEFAULTS = {
  status: "active",
  sort: "code",
  view: "list",
  page: 1,
  perPage: 50,
} as const;

/** Each sort key's natural direction, so an unqualified switch to
 *  "Date added" lands on newest-first rather than 2019. */
const DEFAULT_DIR: Record<(typeof SORT_VALUES)[number], "asc" | "desc"> = {
  code: "asc",
  created_at: "desc",
  updated_at: "desc",
};

/** Changing any of these means different rows, so page 5 stops making
 *  sense. Sort, dir and view are deliberately absent. */
const RESULT_SET_KEYS = [
  "type",
  "tag",
  "attr",
  "status",
  "availability",
  "condition",
  "q",
] as const;

export const Route = createFileRoute("/gear/")({
  staticData: { pageFlag: "gear_inventory" },
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
  },
  validateSearch: searchSchema,
  component: GearIndexPage,
});

function GearIndexPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("gear:manage");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const { value, set } = useToolbarSearchState({
    search,
    defaults: SEARCH_DEFAULTS,
    resultSetKeys: RESULT_SET_KEYS,
    navigate: (next) => void navigate({ search: next }),
  });

  const toolbarState: GearToolbarState = {
    typePublicId: value.type ?? null,
    tagPublicIds: value.tag ?? [],
    attributes: parseAttributeSearchParams(value.attr),
    status: value.status ?? "active",
    availability: value.availability ?? null,
    condition: value.condition ?? null,
    q: value.q ?? "",
    sort: value.sort ?? "code",
    dir: value.dir ?? DEFAULT_DIR[value.sort ?? "code"],
    view: value.view ?? "list",
  };

  const onToolbarChange = (next: Partial<GearToolbarState>) => {
    // Attributes are scoped to a type, so a type change invalidates
    // every facet selection. Left in place they'd AND against the new
    // type's rows and return nothing, with no chip visible to explain
    // it — the toolbar only renders facets for the current type.
    const typeChanged =
      "typePublicId" in next &&
      (next.typePublicId ?? null) !== toolbarState.typePublicId;
    set({
      ...("typePublicId" in next
        ? { type: next.typePublicId ?? undefined }
        : {}),
      ...(typeChanged ? { attr: undefined } : {}),
      ...("tagPublicIds" in next ? { tag: next.tagPublicIds } : {}),
      ...("attributes" in next
        ? { attr: toAttributeSearchParams(next.attributes ?? {}) }
        : {}),
      ...("status" in next ? { status: next.status } : {}),
      ...("availability" in next
        ? { availability: next.availability ?? undefined }
        : {}),
      ...("condition" in next
        ? { condition: next.condition ?? undefined }
        : {}),
      ...("q" in next ? { q: next.q } : {}),
      ...("sort" in next ? { sort: next.sort } : {}),
      ...("dir" in next ? { dir: next.dir } : {}),
      ...("view" in next ? { view: next.view } : {}),
    });
  };

  const [formOpen, setFormOpen] = useState(false);
  const [formIntent, setFormIntent] = useState<GearFormMode>({
    mode: "create",
  });
  const [importOpen, setImportOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [holdsOpen, setHoldsOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [retiring, setRetiring] = useState<GearSummary | null>(null);
  const unretireMutation = useReactivateGear();

  // Selection state lives at the route so it survives view-mode
  // changes (list ↔ grid ↔ table). Reset whenever filters that change
  // the result set move — keeping a publicId selected after it's been
  // filtered out of the visible list would surface as confusing
  // "X selected" with nothing checked.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const filterFingerprint = RESULT_SET_KEYS.map((key) => {
    const part = search[key];
    return Array.isArray(part) ? part.join(",") : (part ?? "");
  }).join("|");
  const lastFingerprintRef = useRef(filterFingerprint);
  useEffect(() => {
    if (lastFingerprintRef.current !== filterFingerprint) {
      lastFingerprintRef.current = filterFingerprint;
      setSelected(new Set());
    }
  }, [filterFingerprint]);
  const selectionApi = useMemo(
    () => ({
      selected,
      toggle: (publicId: string) => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(publicId)) {
            next.delete(publicId);
          } else {
            next.add(publicId);
          }
          return next;
        });
      },
      setAll: (publicIds: string[]) => setSelected(new Set(publicIds)),
      clear: () => setSelected(new Set()),
    }),
    [selected],
  );
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // The menu items go inside the toolbar's dropdown; the dialogs they
  // open have to render as siblings of it, or the click that opens one
  // is the same click that unmounts it with the menu.
  const bulk = useGearBulkActions({
    selectedPublicIds: Array.from(selected),
    statusFilter: toolbarState.status,
    onClear: clearSelection,
  });

  const attributeFacets = toAttributeFacets(toolbarState.attributes);
  const listInput = {
    typePublicId: toolbarState.typePublicId ?? undefined,
    attributes: attributeFacets.length > 0 ? attributeFacets : undefined,
    tagPublicIds:
      toolbarState.tagPublicIds.length > 0
        ? toolbarState.tagPublicIds
        : undefined,
    status: toolbarState.status,
    availability: toolbarState.availability ?? undefined,
    condition: toolbarState.condition ?? undefined,
    q: toolbarState.q.length > 0 ? toolbarState.q : undefined,
    sort: toolbarState.sort,
    dir: toolbarState.dir,
    page: search.page,
    perPage: search.perPage,
  } as const;

  return (
    <PageContainer width="wide" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Gear inventory</h1>
          <p className="text-sm text-muted-foreground">
            Every piece of club gear, addressable by its short code (CH93, LJ4,
            etc.).
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Taxonomy buttons — direct affordances, not behind a
             * dropdown. Officers expect Types and Tags right where the
             * other gear actions live. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTypesOpen(true)}
            >
              <Boxes className="size-4" />
              Types
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModelsOpen(true)}
            >
              <Package className="size-4" />
              Models
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTagsOpen(true)}
            >
              <Tags className="size-4" />
              Tags
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAttributesOpen(true)}
            >
              <SlidersHorizontal className="size-4" />
              Attributes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHoldsOpen(true)}
            >
              <Lock className="size-4" />
              Holds
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSweepOpen(true)}
            >
              <ClipboardCheck className="size-4" />
              Sweep
            </Button>

            {/* Additive split button: primary is "Add gear" (the common
             * case); the chevron only hosts other ways to add gear
             * (today: bulk import). */}
            <ButtonGroup>
              <Button
                size="sm"
                onClick={() => {
                  setFormIntent({ mode: "create" });
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" />
                Add gear
              </Button>
              <ButtonGroupSeparator />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" aria-label="More add options">
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                    <Upload className="size-4" />
                    Bulk import…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </div>
        ) : null}
      </header>
      <GearToolbar
        state={toolbarState}
        onChange={onToolbarChange}
        bulkActions={
          canManage
            ? {
                selectedCount: selected.size,
                items: bulk.items,
                onClearSelection: clearSelection,
                disabled: bulk.busy,
              }
            : undefined
        }
      />
      <GearList
        input={listInput}
        view={toolbarState.view}
        canManage={canManage}
        selection={selectionApi}
        onEdit={(g) => {
          setFormIntent({ mode: "edit", gear: g });
          setFormOpen(true);
        }}
        onRetire={(g) => setRetiring(g)}
        onUnretire={(g) => unretireMutation.mutate({ publicId: g.publicId })}
        onPageChange={(p) => set({ page: p })}
        onPerPageChange={(pp) => set({ perPage: pp, page: undefined })}
      />
      {canManage ? (
        <>
          <GearFormSheet
            open={formOpen}
            onOpenChange={setFormOpen}
            intent={formIntent}
          />
          <GearBulkImportSheet open={importOpen} onOpenChange={setImportOpen} />
          <GearTypesManageDialog open={typesOpen} onOpenChange={setTypesOpen} />
          <GearTagsManageDialog open={tagsOpen} onOpenChange={setTagsOpen} />
          <GearModelsManageDialog
            open={modelsOpen}
            onOpenChange={setModelsOpen}
          />
          <GearHoldsManageDialog open={holdsOpen} onOpenChange={setHoldsOpen} />
          <GearSweepSheet open={sweepOpen} onOpenChange={setSweepOpen} />
          <GearAttributesManageDialog
            open={attributesOpen}
            onOpenChange={setAttributesOpen}
          />
          {bulk.dialogs}
          <GearRetireDialog
            gear={retiring}
            onOpenChange={(o) => {
              if (!o) setRetiring(null);
            }}
          />
        </>
      ) : null}
    </PageContainer>
  );
}
