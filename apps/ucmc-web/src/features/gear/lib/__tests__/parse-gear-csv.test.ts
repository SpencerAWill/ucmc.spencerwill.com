import { describe, expect, it } from "vitest";

import { parseGearCsv } from "#/features/gear/lib/parse-gear-csv";

const TYPES = [
  { publicId: "type_harness", name: "Climbing Harness", prefix: "CH" },
];

describe("parseGearCsv extended columns", () => {
  it("threads manufacturer, serial, msrp, acquisition_kind, tags through", async () => {
    const csv = [
      "type,code,description,model,acquired_at,cost,manufacturer,serial_number,msrp,acquisition_kind,tags",
      'CH,CH1,blue tape,Sama,2024-06-01,60.00,Petzl,ABC-123,84.95,donated,"color:red, size:m"',
    ].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      typePublicId: "type_harness",
      code: "CH1",
      description: "blue tape",
      modelName: "Sama",
      acquisitionCostCents: 6000,
      msrpCents: 8495,
      manufacturer: "Petzl",
      serialNumber: "ABC-123",
      acquisitionKind: "donated",
      tagNames: ["color:red", "size:m"],
    });
  });

  it("rejects an out-of-range acquisition_kind as a parse error", async () => {
    const csv = [
      "type,description,acquisition_kind",
      "CH,Petzl Sama,stolen",
    ].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(rows).toHaveLength(1);
    expect(rows[0].acquisitionKind).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/acquisition_kind must be/);
  });

  it("reads integer cost/msrp cells as dollars (not cents)", async () => {
    const csv = [
      "type,description,cost,msrp",
      "CH,Petzl Sama,60,175",
      'CH,Black Diamond,"$1,200",250.00',
    ].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    // 60 → $60.00 → 6000 cents (not 60).
    expect(rows[0].acquisitionCostCents).toBe(6000);
    expect(rows[0].msrpCents).toBe(17500);
    // Currency punctuation tolerated; decimal forms unchanged.
    expect(rows[1].acquisitionCostCents).toBe(120000);
    expect(rows[1].msrpCents).toBe(25000);
  });

  it("rejects `status` as an acquisition_kind alias", async () => {
    // `status` is deliberately not in the header set: it is too generic
    // and would collide with the item status column on other sheets.
    const csv = ["type,description,status", "CH,Petzl Sama,good"].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].acquisitionKind).toBeNull();
  });

  it("leaves extended fields null when the columns are absent", async () => {
    const csv = ["type,code,description", "CH,CH1,Petzl Sama"].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      manufacturer: null,
      serialNumber: null,
      msrpCents: null,
      acquisitionKind: null,
      tagNames: [],
    });
  });
});

describe("parseGearCsv required columns", () => {
  it("imports a sheet with no description column at all", async () => {
    // The model carries the product name now, so a row only needs
    // distinguishing marks when it has any. This sheet was rejected
    // line-by-line with "Missing description".
    const csv = ["type,model,code", "CH,Sama,CH1"].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "CH1",
      description: null,
      modelName: "Sama",
    });
  });

  it("reads `model` as the product, not as the description", async () => {
    const csv = ["type,model_name,code", "CH,Sama,CH1"].join("\n");
    const { rows } = await parseGearCsv(csv, TYPES);
    expect(rows[0]).toMatchObject({ description: null, modelName: "Sama" });
  });

  it("still takes the model name from a description-only sheet", async () => {
    // A pile of one-offs: each distinct description becomes its own
    // model, which is exactly right for that shape of inventory.
    const csv = ["type,description", "CH,Petzl Sama"].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      description: "Petzl Sama",
      modelName: "Petzl Sama",
    });
  });

  it("flags a row that names no product at all", async () => {
    const csv = ["type,model,code", "CH,,CH1"].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 2, message: "Missing model" }]);
  });
});
