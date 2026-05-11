import { createFileRoute } from "@tanstack/react-router";
import {
  Boxes,
  ChevronDown,
  Plus,
  Settings2,
  Tags,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
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
import { GearFilterBar } from "#/features/gear/components/gear-filter-bar";
import type { GearFilterState } from "#/features/gear/components/gear-filter-bar";
import { GearFormSheet } from "#/features/gear/components/gear-form-sheet";
import type { GearFormMode } from "#/features/gear/components/gear-form-sheet";
import { GearList } from "#/features/gear/components/gear-list";
import { GearRetireDialog } from "#/features/gear/components/gear-retire-dialog";
import { GearTagsManageDialog } from "#/features/gear/components/gear-tags-manage-dialog";
import { GearTypesManageDialog } from "#/features/gear/components/gear-types-manage-dialog";
import { useUnretireGear } from "#/features/gear/api/use-unretire-gear";
import {
  GEAR_CONDITION_VALUES,
  GEAR_LIFECYCLE_VALUES,
} from "#/features/gear/server/gear-fns";
import type { GearSummary } from "#/features/gear/server/gear-fns";

const searchSchema = z.object({
  type: z.string().optional(),
  tag: z.array(z.string()).optional(),
  lifecycle: z.enum(GEAR_LIFECYCLE_VALUES).optional(),
  condition: z.enum(GEAR_CONDITION_VALUES).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(250).optional(),
});

export const Route = createFileRoute("/gear/")({
  validateSearch: searchSchema,
  component: GearIndexPage,
});

function GearIndexPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("gear:manage");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const filterState: GearFilterState = {
    typePublicId: search.type ?? null,
    tagPublicIds: search.tag ?? [],
    lifecycle: search.lifecycle ?? "active",
    condition: search.condition ?? null,
    q: search.q ?? "",
  };

  const onFilterChange = (next: GearFilterState) => {
    void navigate({
      search: {
        type: next.typePublicId ?? undefined,
        tag: next.tagPublicIds.length > 0 ? next.tagPublicIds : undefined,
        lifecycle: next.lifecycle === "active" ? undefined : next.lifecycle,
        condition: next.condition ?? undefined,
        q: next.q.length === 0 ? undefined : next.q,
        page: undefined,
        perPage: search.perPage,
      },
    });
  };

  const [formOpen, setFormOpen] = useState(false);
  const [formIntent, setFormIntent] = useState<GearFormMode>({
    mode: "create",
  });
  const [importOpen, setImportOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [retiring, setRetiring] = useState<GearSummary | null>(null);
  const unretireMutation = useUnretireGear();

  const listInput = {
    typePublicId: search.type,
    tagPublicIds: search.tag && search.tag.length > 0 ? search.tag : undefined,
    lifecycle: search.lifecycle ?? "active",
    condition: search.condition,
    q: search.q,
    page: search.page,
    perPage: search.perPage,
  } as const;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
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
            {/* Configuration dropdown: type/tag CRUD. Kept distinct
             * from the additive split button so officers don't have to
             * mentally separate "add a thing" from "edit the taxonomy"
             * — different mental modes, different buttons. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="size-4" />
                  Manage
                  <ChevronDown className="size-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTypesOpen(true)}>
                  <Boxes className="size-4" />
                  Types…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTagsOpen(true)}>
                  <Tags className="size-4" />
                  Tags…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Additive split button: primary is "Add gear" (the common
             * case); the chevron only hosts other ways to add gear
             * (today: bulk import). Keeps the toolbar narrow on mobile
             * while leaving room for future additive variants. */}
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
      <GearFilterBar state={filterState} onChange={onFilterChange} />
      <GearList
        input={listInput}
        canManage={canManage}
        onEdit={(g) => {
          setFormIntent({ mode: "edit", gear: g });
          setFormOpen(true);
        }}
        onRetire={(g) => setRetiring(g)}
        onUnretire={(g) => unretireMutation.mutate({ publicId: g.publicId })}
        onPageChange={(p) => void navigate({ search: { ...search, page: p } })}
        onPerPageChange={(pp) =>
          void navigate({
            search: { ...search, perPage: pp, page: undefined },
          })
        }
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
          <GearRetireDialog
            gear={retiring}
            onOpenChange={(o) => {
              if (!o) setRetiring(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
