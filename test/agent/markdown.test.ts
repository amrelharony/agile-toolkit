/**
 * Safe markdown subset parser for agent replies.
 */

import { describe, it, expect } from "vitest";
import { tokenizeInline, parseBlocks } from "@/lib/agent/markdown";

describe("tokenizeInline", () => {
  it("parses bold / italic / code", () => {
    expect(tokenizeInline("**b**")).toEqual([{ type: "bold", value: "b" }]);
    expect(tokenizeInline("*i*")).toEqual([{ type: "italic", value: "i" }]);
    expect(tokenizeInline("_i_")).toEqual([{ type: "italic", value: "i" }]);
    expect(tokenizeInline("`c`")).toEqual([{ type: "code", value: "c" }]);
  });

  it("splits surrounding text from a token", () => {
    expect(tokenizeInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "b" },
      { type: "text", value: " c" },
    ]);
  });

  it("allows http(s)/mailto links", () => {
    expect(tokenizeInline("[x](https://e.com)")).toEqual([
      { type: "link", value: "x", href: "https://e.com" },
    ]);
  });

  it("degrades an unsafe link href to literal text (no javascript: URLs)", () => {
    const toks = tokenizeInline("[x](javascript:alert(1))");
    // Never emits a link token, and the literal text round-trips unchanged.
    expect(toks.every((t) => t.type === "text")).toBe(true);
    expect(toks.map((t) => (t.type === "text" ? t.value : "")).join("")).toBe(
      "[x](javascript:alert(1))"
    );
  });

  it("does not interpret markdown inside inline code", () => {
    expect(tokenizeInline("`**not bold**`")).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("does not italicize intraword underscores in snake_case ids", () => {
    // The model is told action ids look like `workspace_sprint_create`; in
    // prose those must not be split/italicized by the `_..._` rule.
    expect(tokenizeInline("workspace_sprint_create")).toEqual([
      { type: "text", value: "workspace_sprint_create" },
    ]);
    expect(tokenizeInline("call foo_bar now")).toEqual([
      { type: "text", value: "call foo_bar now" },
    ]);
    // Standalone underscore emphasis at word boundaries still works.
    expect(tokenizeInline("an _emphasized_ word")).toEqual([
      { type: "text", value: "an " },
      { type: "italic", value: "emphasized" },
      { type: "text", value: " word" },
    ]);
  });

  it("treats raw HTML as plain text", () => {
    expect(tokenizeInline("<script>x</script>")).toEqual([
      { type: "text", value: "<script>x</script>" },
    ]);
  });
});

describe("parseBlocks", () => {
  it("parses headings, paragraphs, lists, and code fences", () => {
    const src = ["# Title", "", "para line", "", "- a", "- b", "", "1. one", "2. two"].join("\n");
    expect(parseBlocks(src)).toEqual([
      { type: "h", text: "Title" },
      { type: "p", text: "para line" },
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["one", "two"] },
    ]);
  });

  it("captures a fenced code block verbatim", () => {
    const src = ["```", "const x = 1;", "x++;", "```"].join("\n");
    expect(parseBlocks(src)).toEqual([{ type: "code", text: "const x = 1;\nx++;" }]);
  });

  it("merges consecutive non-special lines into one paragraph", () => {
    expect(parseBlocks("line one\nline two")).toEqual([{ type: "p", text: "line one\nline two" }]);
  });
});
