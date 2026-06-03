/**
 * geminiPartsText: a Gemini streamed chunk can carry MULTIPLE parts (e.g. a
 * thought part alongside the answer on thinking-enabled 2.5/3 models). The
 * adapter previously read only parts[0].text, dropping later text and risking
 * surfacing a `thought` part as the answer. The helper joins every visible
 * (non-thought) text part in order.
 */

import { describe, it, expect } from "vitest";
import { geminiPartsText } from "@/lib/llm/adapters/gemini";

describe("geminiPartsText", () => {
  it("returns the single part's text", () => {
    expect(geminiPartsText([{ text: "hello" }])).toBe("hello");
  });

  it("concatenates multiple text parts in order (the bug: only parts[0] before)", () => {
    expect(geminiPartsText([{ text: "foo" }, { text: "bar" }, { text: "baz" }])).toBe("foobarbaz");
  });

  it("skips thought parts and keeps the answer", () => {
    expect(geminiPartsText([{ text: "(reasoning…)", thought: true }, { text: "the answer" }])).toBe(
      "the answer"
    );
  });

  it("returns '' when a chunk carries only a thought part", () => {
    expect(geminiPartsText([{ text: "thinking", thought: true }])).toBe("");
  });

  it("handles missing/empty input safely", () => {
    expect(geminiPartsText(undefined)).toBe("");
    expect(geminiPartsText([])).toBe("");
    expect(geminiPartsText([{}, { text: "" }])).toBe("");
  });
});
