import { describe, it, expect } from "vitest";
import { PASTE_LINE_CAP, leftOutMessage, splitPastedLines } from "@/lib/utils/paste-lines";

/**
 * A multi-line paste into an add box: one item per non-empty line, capped,
 * and a one-line paste left to the input.
 */

describe("splitPastedLines", () => {
  it("returns null for a one-line paste, so the input takes it as usual", () => {
    expect(splitPastedLines("Just one card")).toBeNull();
    expect(splitPastedLines("Trailing newline\n")).toBeNull();
    expect(splitPastedLines("\n\n   \n")).toBeNull();
    expect(splitPastedLines("")).toBeNull();
  });

  it("splits on any line ending, trims, and skips blank lines", () => {
    expect(splitPastedLines("  One \r\nTwo\r\n\n   \rThree  ")).toEqual({
      lines: ["One", "Two", "Three"],
      dropped: 0,
    });
  });

  it("drops list markers but keeps text that only looks like one", () => {
    expect(
      splitPastedLines("- Alpha\n* Beta\n• Gamma\n1. Delta\n2) Epsilon\n-5% churn\n1.5 days")
    ).toEqual({
      lines: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "-5% churn", "1.5 days"],
      dropped: 0,
    });
    // A marker on its own is an empty line.
    expect(splitPastedLines("-\nOne\nTwo")?.lines).toEqual(["One", "Two"]);
  });

  it("caps the lines and counts what was left out", () => {
    const text = Array.from({ length: 34 }, (_, i) => `Line ${i + 1}`).join("\n");
    const pasted = splitPastedLines(text)!;
    expect(pasted.lines).toHaveLength(PASTE_LINE_CAP);
    expect(pasted.lines.at(-1)).toBe("Line 30");
    expect(pasted.dropped).toBe(4);

    expect(splitPastedLines("a\nb\nc", 2)).toEqual({ lines: ["a", "b"], dropped: 1 });
    expect(splitPastedLines("a\nb\nc", 0)).toEqual({ lines: [], dropped: 3 });
  });

  it("words the left-out count", () => {
    expect(leftOutMessage(1)).toBe("1 more line was left out.");
    expect(leftOutMessage(4)).toBe("4 more lines were left out.");
  });
});
