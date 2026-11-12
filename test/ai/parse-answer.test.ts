// @vitest-environment node
/**
 * Reading a model's answer tolerantly (lib/ai/parse-answer.ts): fences, prose
 * around the JSON, braces inside strings, a stray brace before it, a list
 * answer, and salvage that keeps the good items of a list.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, parseAnswer, salvageArrays, stripFences } from "@/lib/ai/parse-answer";
import { describeShape, hasArray, missingCaps } from "@/lib/ai/shape";

describe("stripFences", () => {
  it("takes the inside of the first fence, closed or not", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}\n');
    expect(stripFences('text ```\n{"a":1}')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("extractJson", () => {
  it("finds the object after prose, and ignores braces inside strings", () => {
    expect(extractJson('Sure: {"a": "x } y", "b": [1, {"c": 2}]} and more')).toEqual({
      a: "x } y",
      b: [1, { c: 2 }],
    });
  });

  it("handles escaped quotes", () => {
    expect(extractJson('{"a": "say \\"hi\\" {"}')).toEqual({ a: 'say "hi" {' });
  });

  it("skips a stray brace before the JSON", () => {
    expect(extractJson('Use {curly} words. {"ok": true}')).toEqual({ ok: true });
  });

  it("finds a list when asked for one", () => {
    expect(extractJson('Here: ["a", "b"]', "array")).toEqual(["a", "b"]);
  });

  it("gives undefined for no JSON or a cut-off one", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson('{"a": [1, 2')).toBeUndefined();
  });
});

describe("salvageArrays and parseAnswer", () => {
  const schema = z.object({
    title: z.string().max(10),
    items: z
      .array(z.object({ text: z.string().min(1).max(20), tags: z.array(z.string().max(5)).max(2) }))
      .max(3),
    note: z.string().max(30).optional(),
  });

  it("drops bad items, shortens long text, and keeps the list within its maximum", () => {
    const raw = {
      title: "A title that is far too long",
      items: [
        { text: "ok", tags: ["a", "toolongtag", "b", "c"] },
        { text: "", tags: [] },
        "not an item",
        { text: "two", tags: [] },
        { text: "three", tags: [] },
        { text: "four", tags: [] },
      ],
    };
    const fixed = salvageArrays(schema, raw) as z.infer<typeof schema>;
    expect(fixed.title).toHaveLength(10);
    expect(fixed.items.map((i) => i.text)).toEqual(["ok", "two", "three"]);
    // A tag over its cap is shortened, not dropped; the list keeps its first two.
    expect(fixed.items[0].tags).toEqual(["a", "tool…"]);
    expect(schema.safeParse(fixed).success).toBe(true);
  });

  it("fails when the answer has the wrong shape after salvage", () => {
    expect(parseAnswer('{"items": []}', schema)).toEqual({ ok: false });
    expect(parseAnswer("nothing", schema)).toEqual({ ok: false });
  });

  it("parses a top-level list schema", () => {
    const list = z.array(z.string().max(5)).max(2);
    expect(parseAnswer('Answer: ["one", 2, "three", "four"]', list)).toEqual({
      ok: true,
      data: ["one", "three"],
    });
  });
});

describe("shape", () => {
  it("describes a schema in plain words", () => {
    const schema = z.object({
      kind: z.enum(["a", "b"]),
      score: z.number().int().min(0).max(5),
      words: z.array(z.string().max(12)).max(4),
      maybe: z.boolean().optional(),
    });
    expect(describeShape(schema)).toBe(
      '{\n  "kind": one of "a", "b",\n  "score": whole number (0 to 5),\n  "words": [text (at most 12 characters), ...] (at most 4 items),\n  "maybe" (optional): true or false\n}'
    );
    expect(hasArray(schema)).toBe(true);
    expect(hasArray(z.object({ a: z.string().max(3) }))).toBe(false);
  });

  it("finds every uncapped string and list", () => {
    const schema = z.object({
      a: z.string(),
      b: z.array(z.string().max(3)),
      c: z.object({ d: z.array(z.string()).max(2) }),
      e: z.enum(["x"]),
    });
    expect(missingCaps(schema)).toEqual([
      { path: "$.a", what: "string has no maxLength" },
      { path: "$.b", what: "array has no maxItems" },
      { path: "$.c.d[]", what: "string has no maxLength" },
    ]);
  });
});
