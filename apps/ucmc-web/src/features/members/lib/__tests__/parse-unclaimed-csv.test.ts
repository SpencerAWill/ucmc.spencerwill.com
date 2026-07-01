import { describe, expect, it } from "vitest";

import { parseUnclaimedCsv } from "#/features/members/lib/parse-unclaimed-csv";

describe("parseUnclaimedCsv", () => {
  it("parses a simple two-column CSV with a recognized header", async () => {
    const csv = "Name,Email\nAlice,alice@uc.edu\nBob,bob@uc.edu\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: "Alice", email: "alice@uc.edu" },
      { name: "Bob", email: "bob@uc.edu" },
    ]);
  });

  it("accepts column order email-then-name when header makes it explicit", async () => {
    const csv = "Email,Name\ncarol@uc.edu,Carol\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ name: "Carol", email: "carol@uc.edu" }]);
  });

  it("falls back to positional name,email when no recognizable header", async () => {
    const csv = "Dan,dan@uc.edu\nEli,eli@uc.edu\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: "Dan", email: "dan@uc.edu" },
      { name: "Eli", email: "eli@uc.edu" },
    ]);
  });

  it("infers email,name positional order when first cell of row 1 is an email", async () => {
    const csv = "fran@uc.edu,Fran\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ name: "Fran", email: "fran@uc.edu" }]);
  });

  it("preserves quoted commas inside name fields", async () => {
    const csv = `Name,Email\n"Smith, Jr.",smith@uc.edu\n`;
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: "Smith, Jr.", email: "smith@uc.edu" },
    ]);
  });

  it("tolerates BOM and CRLF line endings (Excel/Sheets export)", async () => {
    const csv = "﻿Name,Email\r\nGina,gina@uc.edu\r\nHank,hank@uc.edu\r\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: "Gina", email: "gina@uc.edu" },
      { name: "Hank", email: "hank@uc.edu" },
    ]);
  });

  it("lowercases emails", async () => {
    const csv = "Name,Email\nIvan,IVAN@UC.edu\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.rows).toEqual([{ name: "Ivan", email: "ivan@uc.edu" }]);
  });

  it("flags rows missing fields with their 1-based line number", async () => {
    const csv = "Name,Email\nJane,\n,kim@uc.edu\nLuke,not-an-email\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 2, message: "Missing email" },
      { line: 3, message: "Missing name" },
      { line: 4, message: "Invalid email: not-an-email" },
    ]);
  });

  it("silently skips genuinely empty rows", async () => {
    // Papa with skipEmptyLines drops the bare blank line for us; this
    // checks that an explicit fully-blank cell row still doesn't show
    // up as a "missing both fields" error.
    const csv = "Name,Email\nMia,mia@uc.edu\n,\nNed,ned@uc.edu\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: "Mia", email: "mia@uc.edu" },
      { name: "Ned", email: "ned@uc.edu" },
    ]);
  });

  it("returns empty result for empty input", async () => {
    const result = await parseUnclaimedCsv("");
    expect(result).toEqual({ rows: [], errors: [] });
  });

  it("ignores trailing columns beyond name/email", async () => {
    const csv =
      "Name,Email,Affiliation,Notes\nOscar,oscar@uc.edu,student,trip lead\n";
    const result = await parseUnclaimedCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ name: "Oscar", email: "oscar@uc.edu" }]);
  });
});
