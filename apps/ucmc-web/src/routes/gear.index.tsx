import { createFileRoute } from "@tanstack/react-router";
import {
  Boxes,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
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
import {
  GearToolbar,
  INSPECTION_FILTER_VALUES,
  SERVICE_LIFE_FILTER_VALUES,
} from "#/features/gear/components/gear-toolbar";
import type { GearToolbarState } from "#/features/gear/components/gear-toolbar";
import { GearFormSheet } from "#/features/gear/components/gear-form-sheet";
import type { GearFormMode } from "#/features/gear/components/gear-form-sheet";
import { GearList } from "#/features/gear/components/gear-list";
import { GearModelBrowse } from "#/features/gear/components/gear-model-browse";
import { GearRetireDialog } from "#/features/gear/components/gear-retire-dialog";
import { GearAttributesManageDialog } from "#/features/gear/components/gear-attributes-manage-dialog";
import { GearBatchInspectionsDialog } from "#/features/gear/components/gear-batch-inspections-dialog";
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
  GEAR_WHEREABOUTS_VALUES,
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
const VIEW_VALUES = ["list", "grid", "table", "models"] as const;

const searchSchema = z.object({
  type: z.string().optional(),
  model: z.string().optional(),
  tag: z.array(z.string()).optional(),
  // Facet selections, one repeated param per chosen value:
  // `attr=<defPublicId>:<value>`. Flat and repeated because that is
  // what survives a copied link and a browser Back without a codec.
  attr: z.array(z.string()).optional(),
  inspection: z.enum(INSPECTION_FILTER_VALUES).optional(),
  serviceLife: z.enum(SERVICE_LIFE_FILTER_VALUES).optional(),
  status: z.enum(GEAR_STATUS_VALUES).optional(),
  availability: z.enum(GEAR_AVAILABILITY).optional(),
  condition: z.enum(GEAR_CONDITION_VALUES).optional(),
  whereabouts: z.enum(GEAR_WHEREABOUTS_VALUES).optional(),
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
  "model",
  "tag",
  "attr",
  "inspection",
  "serviceLife",
  "status",
  "availability",
  "condition",
  "whereabouts",
  "q",
] as const;

/** The officer manage surfaces, declared once so the sm+ button row and
 *  the mobile menu can't drift apart. */
interface ManageOpeners {
  types: () => void;
  models: () => void;
  tags: () => void;
  attributes: () => void;
  holds: () => void;
  sweep: () => void;
  batchInspections: () => void;
}

const MANAGE_ACTIONS: Array<{
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  open: (o: ManageOpeners) => void;
  /** Which grant this surface answers to. All but one are catalog
   *  writes; batch inspections ride on `gear:inspect`, the delegable
   *  permission, so a trip leader sees that button and nothing else. */
  permission: "gear:manage" | "gear:inspect";
}> = [
  {
    label: "Types",
    icon: Boxes,
    open: (o) => o.types(),
    permission: "gear:manage",
  },
  {
    label: "Models",
    icon: Package,
    open: (o) => o.models(),
    permission: "gear:manage",
  },
  {
    label: "Tags",
    icon: Tags,
    open: (o) => o.tags(),
    permission: "gear:manage",
  },
  {
    label: "Attributes",
    icon: SlidersHorizontal,
    open: (o) => o.attributes(),
    permission: "gear:manage",
  },
  {
    label: "Holds",
    icon: Lock,
    open: (o) => o.holds(),
    permission: "gear:manage",
  },
  {
    label: "Sweep",
    icon: ClipboardCheck,
    open: (o) => o.sweep(),
    permission: "gear:manage",
  },
  {
    label: "Inspections",
    icon: ClipboardList,
    open: (o) => o.batchInspections(),
    permission: "gear:inspect",
  },
];

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
  // The same OR `requireGearInspector` applies server-side: the narrow
  // grant exists so an inspector needs no catalog authority, and a
  // manager keeps what they already had. There is no permission
  // implication mechanism in this codebase, so it is spelled out.
  const canInspect = hasPermission("gear:inspect") || canManage;
  const manageActions = MANAGE_ACTIONS.filter((action) =>
    action.permission === "gear:manage" ? canManage : canInspect,
  );
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
    modelPublicId: value.model ?? null,
    tagPublicIds: value.tag ?? [],
    attributes: parseAttributeSearchParams(value.attr),
    inspection: value.inspection ?? null,
    serviceLife: value.serviceLife ?? null,
    status: value.status ?? "active",
    availability: value.availability ?? null,
    condition: value.condition ?? null,
    whereabouts: value.whereabouts ?? null,
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
      ...("modelPublicId" in next
        ? { model: next.modelPublicId ?? undefined }
        : {}),
      ...("tagPublicIds" in next ? { tag: next.tagPublicIds } : {}),
      ...("attributes" in next
        ? { attr: toAttributeSearchParams(next.attributes ?? {}) }
        : {}),
      ...("status" in next ? { status: next.status } : {}),
      ...("availability" in next
        ? { availability: next.availability ?? undefined }
        : {}),
      ...("whereabouts" in next
        ? { whereabouts: next.whereabouts ?? undefined }
        : {}),
      ...("condition" in next
        ? { condition: next.condition ?? undefined }
        : {}),
      ...("inspection" in next
        ? { inspection: next.inspection ?? undefined }
        : {}),
      ...("serviceLife" in next
        ? { serviceLife: next.serviceLife ?? undefined }
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
  const [batchInspectionsOpen, setBatchInspectionsOpen] = useState(false);
  const openers: ManageOpeners = {
    types: () => setTypesOpen(true),
    models: () => setModelsOpen(true),
    tags: () => setTagsOpen(true),
    attributes: () => setAttributesOpen(true),
    holds: () => setHoldsOpen(true),
    sweep: () => setSweepOpen(true),
    batchInspections: () => setBatchInspectionsOpen(true),
  };
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
    modelPublicId: toolbarState.modelPublicId ?? undefined,
    attributes: attributeFacets.length > 0 ? attributeFacets : undefined,
    tagPublicIds:
      toolbarState.tagPublicIds.length > 0
        ? toolbarState.tagPublicIds
        : undefined,
    status: toolbarState.status,
    availability: toolbarState.availability ?? undefined,
    condition: toolbarState.condition ?? undefined,
    whereabouts: toolbarState.whereabouts ?? undefined,
    inspection: toolbarState.inspection ?? undefined,
    serviceLife: toolbarState.serviceLife ?? undefined,
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
        {manageActions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Six manage surfaces. At sm+ they are direct affordances —
             * officers expect Types and Tags right where the other gear
             * actions live. Below that they collapse into one menu:
             * seven buttons wrapped to three rows on a 390px screen and
             * pushed the search box, the filters and the first piece of
             * gear under the fold, on the device the cave desk actually
             * runs on. */}
            <div className="hidden items-center gap-2 sm:flex">
              {manageActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  size="sm"
                  onClick={() => action.open(openers)}
                >
                  <action.icon className="size-4" />
                  {action.label}
                </Button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="sm:hidden">
                  <SlidersHorizontal className="size-4" />
                  Manage
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {manageActions.map((action) => (
                  <DropdownMenuItem
                    key={action.label}
                    onSelect={() => action.open(openers)}
                  >
                    <action.icon className="size-4" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Additive split button: primary is "Add gear" (the common
             * case); the chevron only hosts other ways to add gear
             * (today: bulk import). Manager-only — the bar itself now
             * renders for an inspector, who has no business adding
             * gear and would get a server refusal if they tried. */}
            {canManage ? (
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
            ) : null}
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
      {toolbarState.view === "models" ? (
        <GearModelBrowse
          typePublicId={toolbarState.typePublicId}
          q={toolbarState.q}
          onPick={(modelPublicId) =>
            // Land on the item list already narrowed: this is the step
            // from "7 available" to a code somebody can ask for.
            set({ model: modelPublicId, view: "list", page: undefined })
          }
        />
      ) : (
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
      )}
      {canInspect ? (
        <GearBatchInspectionsDialog
          open={batchInspectionsOpen}
          onOpenChange={setBatchInspectionsOpen}
        />
      ) : null}
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
