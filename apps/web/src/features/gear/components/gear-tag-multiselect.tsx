import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { useCreateGearTag } from "#/features/gear/api/use-create-gear-tag";
import type { GearTagSummary } from "#/features/gear/server/gear-fns";

/**
 * Multi-select tag picker with inline create-tag-on-empty-search. Driven
 * by the gear edit/create sheet. Tag creation goes through
 * `useCreateGearTag` so the audit log captures who introduced the
 * label.
 */
export function GearTagMultiselect({
  allTags,
  selectedPublicIds,
  onChange,
  canCreate,
}: {
  allTags: GearTagSummary[];
  selectedPublicIds: string[];
  onChange: (publicIds: string[]) => void;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const createTag = useCreateGearTag();

  const selected = new Set(selectedPublicIds);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? allTags.filter((t) => t.name.toLowerCase().includes(normalizedQuery))
    : allTags;
  const exactMatch = allTags.find((t) => t.name === normalizedQuery);
  const canShowCreate = canCreate && normalizedQuery.length > 0 && !exactMatch;

  const toggle = (publicId: string) => {
    const next = new Set(selected);
    if (next.has(publicId)) {
      next.delete(publicId);
    } else {
      next.add(publicId);
    }
    onChange(Array.from(next));
  };

  const handleCreate = () => {
    if (normalizedQuery.length === 0) return;
    createTag.mutate(
      { name: normalizedQuery },
      {
        onSuccess: (result) => {
          if (result.ok) {
            onChange([...selectedPublicIds, result.publicId]);
            setQuery("");
            toast.success(`Tag #${result.name} created`);
          } else if (result.reason === "name_in_use") {
            toast.error("That tag already exists.");
          } else {
            toast.error("Couldn't create tag.");
          }
        },
        onError: () => {
          toast.error("Couldn't create tag.");
        },
      },
    );
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedPublicIds.length === 0
              ? "Select tags…"
              : `${selectedPublicIds.length} selected`}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <div className="p-2">
            <Input
              autoFocus
              placeholder="Search tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto border-t">
            {filtered.length === 0 && !canShowCreate ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No tags.
              </p>
            ) : (
              <ul className="py-1">
                {filtered.map((tag) => {
                  const isSelected = selected.has(tag.publicId);
                  return (
                    <li key={tag.publicId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => toggle(tag.publicId)}
                      >
                        <Check
                          className={`size-4 ${
                            isSelected ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        #{tag.name}
                      </button>
                    </li>
                  );
                })}
                {canShowCreate ? (
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={handleCreate}
                      disabled={createTag.isPending}
                    >
                      <Plus className="size-4" />
                      Create #{normalizedQuery}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedPublicIds.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {allTags
            .filter((t) => selected.has(t.publicId))
            .map((t) => (
              <Badge key={t.publicId} variant="outline">
                #{t.name}
                <button
                  type="button"
                  className="ml-1 -mr-1 text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(t.publicId)}
                  aria-label={`Remove ${t.name}`}
                >
                  ×
                </button>
              </Badge>
            ))}
        </div>
      ) : null}
    </div>
  );
}
