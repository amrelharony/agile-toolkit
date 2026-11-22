import { describe, expect, it } from "vitest";
import { jsonBytes } from "@/lib/utils/json-bytes";

/**
 * jsonBytes is the one byte counter for every budget (AI input fitters, row
 * checks, the server blob writer): the UTF-8 length of the value's JSON.
 */

describe("jsonBytes", () => {
  it("counts ASCII one byte a character, quotes and punctuation included", () => {
    expect(jsonBytes("abc")).toBe(5); // "abc"
    expect(jsonBytes({ a: 1 })).toBe(7); // {"a":1}
    expect(jsonBytes([1, 2, 3])).toBe(7); // [1,2,3]
    expect(jsonBytes(42)).toBe(2);
    expect(jsonBytes(true)).toBe(4);
    expect(jsonBytes(null)).toBe(4);
    expect(jsonBytes("")).toBe(2);
  });

  it("counts two bytes for Latin accents and Arabic", () => {
    expect(jsonBytes("é")).toBe(2 + 2);
    expect(jsonBytes("مرحبا")).toBe(2 + 5 * 2);
  });

  it("counts three bytes for the rest of the Basic Multilingual Plane (CJK)", () => {
    expect(jsonBytes("漢字")).toBe(2 + 2 * 3);
    // One counted UTF-16 unit, three bytes: the most real capped text costs.
    expect("漢".length).toBe(1);
  });

  it("counts four bytes for an astral character, which is two UTF-16 units", () => {
    expect("😀".length).toBe(2);
    expect(jsonBytes("😀")).toBe(2 + 4);
  });

  it("counts the JSON escapes of control characters and lone surrogates", () => {
    expect(jsonBytes("\u0001")).toBe(2 + 6); // "\u0001"
    expect(jsonBytes("\ud800")).toBe(2 + 6); // "\ud800"
    expect(jsonBytes('"')).toBe(2 + 2); // "\""
    expect(jsonBytes("\n")).toBe(2 + 2); // "\n"
  });

  it("measures a nested value exactly as JSON.stringify writes it", () => {
    const value = { title: "Café ☕", tags: ["漢", "a"], n: 1.5, skip: undefined };
    const expected = new TextEncoder().encode(JSON.stringify(value)).length;
    expect(jsonBytes(value)).toBe(expected);
    // An undefined field is left out, as JSON leaves it out.
    expect(jsonBytes({ a: 1, b: undefined })).toBe(jsonBytes({ a: 1 }));
  });

  it("measures 0 for a value with no JSON", () => {
    expect(jsonBytes(undefined)).toBe(0);
    expect(jsonBytes(() => 1)).toBe(0);
    expect(jsonBytes(Symbol("x"))).toBe(0);
  });

  it("throws where JSON.stringify throws", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => jsonBytes(loop)).toThrow();
    expect(() => jsonBytes(BigInt(1))).toThrow();
  });
});
