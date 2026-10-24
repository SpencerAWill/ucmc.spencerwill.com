---
paths:
  - "apps/ucmc-web/src/features/gear/**/*attribute*"
  - "apps/ucmc-web/src/features/gear/components/gear-form-sheet.tsx"
  - "apps/ucmc-web/src/features/gear/components/gear-toolbar.tsx"
  - "apps/ucmc-web/src/features/gear/**/*bulk-import*"
  - "apps/ucmc-web/src/features/gear/lib/parse-gear-csv.ts"
  - "apps/ucmc-web/src/features/gear/server/repo.server.ts"
  - "apps/ucmc-web/src/routes/gear.index.tsx"
---

# Gear custom attributes and facets

Part of the gear rule; `gear/core.md` holds the type → model → item shape these hang off.

## Custom attributes, at two levels

Officer-defined attributes scoped to types via `gear_attribute_def_types` (a join table, so `Colour` is defined once and attached to many types). `level` is `model` or `item`: rope diameter is typed once for a fleet of forty, harness size varies per unit. A counted model has no items, so only model-level values can exist for it — that falls out of the shape rather than needing a rule.

Four kinds: `text`, `number`, `select`, `boolean`. **The unit lives on the definition, never in the value** — a value of `"60m"` is text and stops being range-filterable, which defeats the point. **`select` options carry explicit ordering**; sorting sizes alphabetically yields `L, M, S, XL`.

Values live across two columns, and which one a kind uses is decided **once**, in `coerceAttributeValue` (`lib/attributes.ts`): numbers and booleans in `value_number` (booleans as 0/1, matching every other boolean in the schema), text and select in `value_text`. The forms, the facets and the detail card all read that same function, so a value written by one surface reads back identically in the others.

Three rules are enforced in `attributes-actions.server.ts` rather than the schema, because all three are about intent rather than integrity:

- **`key` is derived once from the label and never re-derived.** It is what every stored value points at; re-deriving on a relabel would orphan them all. Renaming "Size" to "Harness size" keeps `size`.
- **`kind` and `level` are immutable after creation.** Flipping a select to a number leaves every answer in the wrong column, and model → item can't say which item inherits the fleet's answer. Archive and redefine. The manage dialog shows both read-only on edit rather than letting a save fail.
- **Deleting a def with answers against it is refused** (`has_values`, with the count). The FK cascades, so the database would take every answer with it. Archiving is the reversible door and sits in the same row.

**Archiving is a soft delete that keeps values readable.** Archived defs drop off the forms and facets but their recorded answers still render — an answer that was given is still true, and hiding it the moment someone archives the question makes the detail card quietly lie. Detaching a type likewise does **not** delete values.

Officers manage definitions from the **Attributes** button on `/gear`, beside Types and Tags. Model-level answers are collected in the inline model-creation panel of the add-gear sheet; item-level ones render in the sheet itself, keyed off the selected type.

`resolveAttributeWrites` is the one path from a submitted form to the value tables, shared by the item and model actions:

- **Definitions the caller didn't mention are left alone.** The item form renders item-level defs for one type and must not wipe an answer belonging to a def it never showed — which is also why `attributes: undefined` on edit means "no change", matching `serialNumber` and `thumbnailDataUrl`. Editing from the list (a `GearSummary`, which never carried the answers) therefore leaves them intact.
- **Definitions mentioned but not attached to this type, or archived, are ignored rather than rejected.** A form submitted moments after somebody detached a type is stale, not malicious.
- **`required` is enforced whether the field arrives blank or not at all**, so omitting it isn't a way around the rule. Validation runs **before** the insert and the thumbnail upload, so a refused value can't leave a half-made item behind.

## Attribute facets on the gear page

Once a type is selected, the toolbar grows one filter per `select` or `boolean` definition attached to it. **Free text and number kinds get no facet** — free text would list four hundred distinct answers, and a number wants a range, which belongs with the browse-by-model redesign.

- **Values within one facet are OR'd; separate facets are AND'd.** This is the opposite of the tag filter, and deliberately: a tag is a label somebody chose to stick on, while an attribute answers a fixed question, so two values of the same question are alternatives. "M or L" works here and returns nothing as tags.
- **Facets appear only with a type selected.** Unscoped, the list would be every question the club has ever asked, most of them meaningless for most rows.
- **Changing the type clears the selections.** Left in place they would AND against the new type's rows and return nothing, with no chip visible to explain it.
- **Every facet travels as one bound parameter** (`attributeFacetsWhere`): a JSON array of `{ d, t, n }` unpacked by `json_each`, matched as `NOT EXISTS (a facet WHERE NOT matched)`. Each facet checks **both** value tables OR'd together — the repo isn't told which level a definition lives at, and since a def only ever has rows in its own level's table, the union is exact rather than a guess. It used to be one `EXISTS` per facet with a placeholder per value, bound twice per level: the schema's 20 facets × 50 values reached 2040 parameters, and one facet with ~48 values was enough to break the page (#291).
- URL shape is a repeated `attr=<defPublicId>:<value>` param, split on the **first** colon so a value containing one ("1:1 taper") round-trips. Malformed or unknown entries are dropped, never refused: a shared link outliving its definition should widen the list, not break the page.

**Bulk import does not enforce `required`** — it calls `insertGearItem` directly rather than going through `createGearAction`, and predates attributes entirely. A CSV of forty harnesses lands with no size answered even where size is required.
