import { describe, expect, it } from "vitest";

import { formatPhone, phoneHref } from "#/lib/phone-format";

describe("formatPhone", () => {
  it("renders a US number in national form", () => {
    expect(formatPhone("+15135551234")).toBe("(513) 555-1234");
    expect(formatPhone("+14402411295")).toBe("(440) 241-1295");
  });

  it("keeps the country code on a non-US number", () => {
    // National form would be "020 7123 4567" — undialable from the US,
    // which is why non-local numbers get the international format.
    expect(formatPhone("+442071234567")).toBe("+44 20 7123 4567");
  });

  it("returns an empty string for a missing number", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone(undefined)).toBe("");
    expect(formatPhone("")).toBe("");
    expect(formatPhone("   ")).toBe("");
  });

  it("falls back to the stored string when it can't be parsed", () => {
    // Only reachable via rows predating `phoneSchema`'s E.164
    // validation; showing the digits on file beats showing nothing.
    expect(formatPhone("5135551234")).toBe("5135551234");
    expect(formatPhone("(513) 555-1234")).toBe("(513) 555-1234");
    expect(formatPhone("ext. 4")).toBe("ext. 4");
  });

  it("does not reformat a number that parses but isn't valid", () => {
    // "+1513" parses with no country; national form would render the
    // lossy fragment "513", so the raw value wins instead.
    expect(formatPhone("+1513")).toBe("+1513");
  });
});

describe("phoneHref", () => {
  it("hands the dialer canonical E.164 regardless of display form", () => {
    expect(phoneHref("+15135551234")).toBe("tel:+15135551234");
    expect(phoneHref("+442071234567")).toBe("tel:+442071234567");
  });

  it("is undefined when the value isn't a dialable number", () => {
    expect(phoneHref(null)).toBeUndefined();
    expect(phoneHref("")).toBeUndefined();
    expect(phoneHref("5135551234")).toBeUndefined();
    expect(phoneHref("+1513")).toBeUndefined();
  });
});
