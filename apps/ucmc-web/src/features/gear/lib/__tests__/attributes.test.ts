import { describe, expect, it } from "vitest";

import {
  attributeKeyFromLabel,
  attributeValueToFormValue,
  coerceAttributeValue,
  formatAttributeValue,
  parseAttributeSearchParams,
  toAttributeFacets,
  toAttributeSearchParams,
} from "#/features/gear/lib/attributes";

describe("coerceAttributeValue", () => {
  it("routes each kind to the column it can be queried from", () => {
    expect(
      coerceAttributeValue(
        { kind: "number", options: null, required: false },
        "9.8",
      ),
    ).toEqual({ ok: true, text: null, number: 9.8 });
    expect(
      coerceAttributeValue(
        { kind: "text", options: null, required: false },
        "blue",
      ),
    ).toEqual({ ok: true, text: "blue", number: null });
    // Booleans go numeric, matching every other boolean in the schema.
    expect(
      coerceAttributeValue(
        { kind: "boolean", options: null, required: false },
        "true",
      ),
    ).toEqual({ ok: true, text: null, number: 1 });
  });

  it("treats a blank as cleared, not as zero or empty string", () => {
    // Both columns null is what `setItemAttributeValues` reads as
    // "delete this answer" — storing "" would leave a row that renders
    // as an empty field forever.
    for (const raw of ["", "   ", null]) {
      expect(
        coerceAttributeValue(
          { kind: "text", options: null, required: false },
          raw,
        ),
      ).toEqual({ ok: true, text: null, number: null });
    }
  });

  it("refuses a blank on a required definition", () => {
    expect(
      coerceAttributeValue({ kind: "text", options: null, required: true }, ""),
    ).toEqual({ ok: false, reason: "required" });
  });

  it("refuses a number that isn't one", () => {
    expect(
      coerceAttributeValue(
        { kind: "number", options: null, required: false },
        "9.8mm",
      ),
    ).toEqual({ ok: false, reason: "not_a_number" });
  });

  it("refuses a select value outside the option list", () => {
    const def = {
      kind: "select" as const,
      options: ["S", "M"],
      required: false,
    };
    expect(coerceAttributeValue(def, "XL")).toEqual({
      ok: false,
      reason: "not_an_option",
    });
    expect(coerceAttributeValue(def, " M ")).toEqual({
      ok: true,
      text: "M",
      number: null,
    });
  });
});

describe("formatAttributeValue", () => {
  it("prints the unit from the definition, not from the value", () => {
    expect(
      formatAttributeValue({
        kind: "number",
        unit: "mm",
        text: null,
        number: 9.8,
      }),
    ).toBe("9.8 mm");
    expect(
      formatAttributeValue({
        kind: "number",
        unit: null,
        text: null,
        number: 60,
      }),
    ).toBe("60");
  });

  it("renders booleans as words", () => {
    expect(
      formatAttributeValue({
        kind: "boolean",
        unit: null,
        text: null,
        number: 1,
      }),
    ).toBe("Yes");
    expect(
      formatAttributeValue({
        kind: "boolean",
        unit: null,
        text: null,
        number: 0,
      }),
    ).toBe("No");
  });

  it("returns null for an unanswered attribute", () => {
    // Callers drop these rather than rendering "Size —", which reads as
    // a data problem rather than an unanswered question.
    expect(
      formatAttributeValue({
        kind: "text",
        unit: null,
        text: null,
        number: null,
      }),
    ).toBeNull();
    expect(
      formatAttributeValue({
        kind: "text",
        unit: null,
        text: "",
        number: null,
      }),
    ).toBeNull();
  });
});

describe("attributeValueToFormValue", () => {
  it("round-trips every kind back through coercion unchanged", () => {
    const cases = [
      {
        def: { kind: "number" as const, options: null, required: false },
        raw: "9.8",
      },
      {
        def: { kind: "text" as const, options: null, required: false },
        raw: "blue",
      },
      {
        def: { kind: "select" as const, options: ["S", "M"], required: false },
        raw: "M",
      },
      {
        def: { kind: "boolean" as const, options: null, required: false },
        raw: "true",
      },
    ];
    for (const { def, raw } of cases) {
      const stored = coerceAttributeValue(def, raw);
      if (!stored.ok) throw new Error(`coercion failed for ${def.kind}`);
      const backToForm = attributeValueToFormValue({
        kind: def.kind,
        text: stored.text,
        number: stored.number,
      });
      // An edit that changes nothing must store nothing different —
      // otherwise every save quietly rewrites the row.
      expect(coerceAttributeValue(def, backToForm)).toEqual(stored);
    }
  });
});

describe("attributeKeyFromLabel", () => {
  it("collapses punctuation and spacing into one stable key", () => {
    expect(attributeKeyFromLabel("Rope diameter")).toBe("rope_diameter");
    expect(attributeKeyFromLabel("  Size (EU) ")).toBe("size_eu");
    expect(attributeKeyFromLabel("---")).toBe("");
  });
});

describe("attribute search params", () => {
  it("round-trips selections through the URL shape", () => {
    const selections = { def1: ["S", "M"], def2: ["true"] };
    const params = toAttributeSearchParams(selections);
    expect(params).toEqual(["def1:S", "def1:M", "def2:true"]);
    expect(parseAttributeSearchParams(params)).toEqual(selections);
  });

  it("splits on the first colon only", () => {
    // A value may legitimately contain a colon — "1:1 taper" — and
    // splitting on the last one would lose the def id.
    expect(parseAttributeSearchParams(["def1:1:1 taper"])).toEqual({
      def1: ["1:1 taper"],
    });
  });

  it("drops malformed entries rather than throwing", () => {
    // A hand-edited or truncated shared link should widen the list, not
    // break the page.
    expect(
      parseAttributeSearchParams(["nocolon", ":orphan", "def1:", "def1:M"]),
    ).toEqual({ def1: ["M"] });
  });

  it("omits the param entirely when nothing is selected", () => {
    expect(toAttributeSearchParams({})).toBeUndefined();
    expect(toAttributeSearchParams({ def1: [] })).toBeUndefined();
    expect(parseAttributeSearchParams(undefined)).toEqual({});
  });

  it("drops empty facets on the way to the server", () => {
    expect(toAttributeFacets({ def1: ["M"], def2: [] })).toEqual([
      { defPublicId: "def1", values: ["M"] },
    ]);
  });
});
