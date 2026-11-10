/**
 * cutText (lib/utils/cut-text.ts): text cut to a length without keeping
 * half of a character, so what is saved stays valid for Postgres jsonb.
 */

import { describe, expect, it } from "vitest";
import { cutText } from "@/lib/utils/cut-text";

describe("cutText", () => {
  it("leaves text within the length as it is", () => {
    expect(cutText("abc", 3)).toBe("abc");
    expect(cutText("😀", 2)).toBe("😀");
    expect(cutText("", 5)).toBe("");
  });

  it("cuts to the length", () => {
    expect(cutText("abcdef", 4)).toBe("abcd");
    expect(cutText("ab😀cd", 4)).toBe("ab😀");
    expect(cutText("abc", 0)).toBe("");
  });

  it("drops a character the cut would split, instead of keeping half of it", () => {
    // "😀" is two UTF-16 units: a cut after 3 would keep its first half.
    const cut = cutText("ab😀cd", 3);
    expect(cut).toBe("ab");
    expect(JSON.stringify(cutText("😀😀", 3))).toBe('"😀"');
    expect(JSON.stringify(cutText("x😀", 2))).not.toMatch(/\\ud83d/i);
  });
});
