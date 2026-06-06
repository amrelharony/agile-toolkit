import { describe, expect, it } from "vitest";
import { redactPii, looksLikePii } from "@/lib/utils/redact-pii";

/**
 * Regression: the phone pattern used to run BEFORE the credit-card pattern.
 * A formatted 16-digit card ("4111 1111 1111 1111") is longer than the
 * phone pattern's max span, so phone matched the leading three groups and
 * stopped at the separator before the final group — leaving the last 4
 * digits (the segment users most want hidden) in clear text. The CC pattern
 * must run first so the whole card span is consumed.
 */
describe("redactPii — credit cards", () => {
  it("redacts a space-separated 16-digit card in full (no trailing digit leak)", () => {
    const out = redactPii("4111 1111 1111 1111");
    expect(out).toBe("[redacted:cc]");
    expect(out).not.toMatch(/\d/); // no digits survive
  });

  it("redacts a dash-separated card in full", () => {
    expect(redactPii("4111-1111-1111-1111")).toBe("[redacted:cc]");
  });

  it("redacts a card embedded in a sentence without leaking the last group", () => {
    const out = redactPii("My card 5500 0000 0000 0004 thanks");
    expect(out).toBe("My card [redacted:cc] thanks");
    expect(out).not.toMatch(/0004/);
  });

  it("redacts a grouped Amex (15-digit) number", () => {
    const out = redactPii("Amex 3782 822463 10005");
    expect(out).toContain("[redacted:cc]");
    expect(out).not.toMatch(/10005/);
  });

  it("redacts a bare (separator-less) 16-digit card", () => {
    expect(redactPii("4111111111111111")).toBe("[redacted:cc]");
  });
});

describe("redactPii — phone numbers still work after reordering", () => {
  it("redacts an international phone number", () => {
    expect(redactPii("call me at +1 415 555 1234 ok")).toBe("call me at [redacted:phone] ok");
  });

  it("does not mistake a short phone number for a credit card", () => {
    // 11 digits — below the CC pattern's 14-digit floor.
    expect(redactPii("+44 20 7946 0958")).toContain("[redacted:phone]");
  });
});

describe("redactPii — other PII classes (unchanged)", () => {
  it("redacts emails", () => {
    expect(redactPii("ping a.elharony@gmail.com")).toBe("ping [redacted:email]");
  });

  it("looksLikePii flags a formatted card", () => {
    expect(looksLikePii("4111 1111 1111 1111")).toBe(true);
  });
});
