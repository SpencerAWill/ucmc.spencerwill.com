import { describe, expect, it } from "vitest";

import { parseGearCsv } from "#/features/gear/lib/parse-gear-csv";

const TYPES = [
  { publicId: "type_harness", name: "Climbing Harness", prefix: "CH" },
];

describe("parseGearCsv extended columns", () => {
  it("threads manufacturer, serial, msrp, condition_grade, tags through", async () => {
    const csv = [
      "type,code,description,acquired_at,cost,manufacturer,serial_number,msrp,condition_grade,tags",
      'CH,CH1,Petzl Sama,2024-06-01,60.00,Petzl,ABC-123,84.95,good,"color:red, size:m"',
    ].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      typePublicId: "type_harness",
      code: "CH1",
      description: "Petzl Sama",
      acquisitionCostCents: 6000,
      msrpCents: 8495,
      manufacturer: "Petzl",
      serialNumber: "ABC-123",
      conditionGrade: "good",
      tagNames: ["color:red", "size:m"],
    });
  });

  it("rejects an out-of-range condition_grade as a parse error", async () => {
    const csv = [
      "type,description,condition_grade",
      "CH,Petzl Sama,perfect",
    ].join("\n");
    const { rows, errors } = await parseGearCsv(csv, TYPES);
    expect(rows).toHaveLength(1);
    expect(rows[0].conditionGrade).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/condition_grade must be/);
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
      conditionGrade: null,
      tagNames: [],
    });
  });
});
