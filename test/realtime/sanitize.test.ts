import { describe, it, expect } from "vitest";
import {
  CONTROL_OR_BIDI_RE,
  MAX_NAME_LENGTH,
  cleanName,
  cleanPlayerName,
  cleanText,
  hasControlOrBidi,
  isWithinJsonSize,
  shareableText,
} from "@/lib/realtime/sanitize";
import * as players from "@/app/(tools)/planning-poker/players";

describe("shareableText (the host's own text, before it is shared)", () => {
  it("strips hidden characters instead of refusing, keeps one line, and cuts to max", () => {
    expect(shareableText("Fun‮ at\n\twork⁦", 80)).toBe("Fun at work");
    expect(shareableText("a".repeat(50), 10)).toBe("a".repeat(10));
    expect(shareableText("‮⁩  ", 80)).toBe("");
    // What it returns, a peer's cleanText accepts unchanged.
    const shared = shareableText("Ship\u0007 it  ‏ now", 80);
    expect(cleanText(shared, 80)).toBe(shared);
  });
});

const UNSAFE = [
  ["NUL", "\u0000"],
  ["BEL", "\u0007"],
  ["ESC", "\u001B"],
  ["DEL", "\u007F"],
  ["ALM", "؜"],
  ["LRM", "‎"],
  ["RLM", "‏"],
  ["LRE", "‪"],
  ["RLE", "‫"],
  ["PDF", "‬"],
  ["LRO", "‭"],
  ["RLO", "‮"],
  ["LRI", "⁦"],
  ["RLI", "⁧"],
  ["FSI", "⁨"],
  ["PDI", "⁩"],
] as const;

describe("hasControlOrBidi", () => {
  it.each(UNSAFE)("flags %s", (_name, ch) => {
    expect(hasControlOrBidi(`ab${ch}cd`)).toBe(true);
  });

  it.each(["Alice", "Zoë", "José María", "محمد", "李雷", "🦊 Fox", "👨‍👩‍👧"])(
    "passes ordinary text: %s",
    (s) => {
      expect(hasControlOrBidi(s)).toBe(false);
    }
  );

  it("is safe to share (no global flag, so no lastIndex carry-over)", () => {
    expect(CONTROL_OR_BIDI_RE.global).toBe(false);
    expect(hasControlOrBidi("‮")).toBe(true);
    expect(hasControlOrBidi("‮")).toBe(true);
  });
});

describe("cleanPlayerName", () => {
  it("collapses whitespace, trims and caps at the validator's length", () => {
    expect(cleanPlayerName("  Ada \n  Lovelace ")).toBe("Ada Lovelace");
    expect(cleanPlayerName("x".repeat(200))).toHaveLength(MAX_NAME_LENGTH);
  });

  it("is still exported from the poker players module", () => {
    expect(players.cleanPlayerName).toBe(cleanPlayerName);
    expect(players.MAX_NAME_LENGTH).toBe(MAX_NAME_LENGTH);
  });
});

describe("cleanName", () => {
  it("returns the cleaned name", () => {
    expect(cleanName("  Ada\tLovelace ")).toBe("Ada Lovelace");
  });

  it("cuts to the cap", () => {
    expect(cleanName("y".repeat(300))).toBe("y".repeat(MAX_NAME_LENGTH));
    expect(cleanName("abcdef", 3)).toBe("abc");
  });

  it.each(UNSAFE.filter(([n]) => n !== "NUL"))("rejects a name with %s", (_n, ch) => {
    expect(cleanName(`Sam${ch}`)).toBeNull();
  });

  it("rejects NUL, blanks and non-strings", () => {
    expect(cleanName("Sam\u0000")).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("")).toBeNull();
    expect(cleanName(undefined)).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName({ toString: () => "Sam" })).toBeNull();
  });

  it("never leaves half a surrogate pair at the cut", () => {
    const name = `${"a".repeat(MAX_NAME_LENGTH - 1)}🦊`;
    const out = cleanName(name);
    expect(out).toBe("a".repeat(MAX_NAME_LENGTH - 1));
  });
});

describe("cleanText", () => {
  it("makes one trimmed line", () => {
    expect(cleanText("  Ship it\n\nsooner  ", 500)).toBe("Ship it sooner");
  });

  it("cuts to max", () => {
    expect(cleanText("z".repeat(600), 500)).toHaveLength(500);
  });

  it("rejects bidi and control characters", () => {
    expect(cleanText("good ‮dab", 500)).toBeNull();
    expect(cleanText("bell\u0007", 500)).toBeNull();
  });

  it("rejects empty text, non-strings and a non-positive max", () => {
    expect(cleanText("  \n ", 500)).toBeNull();
    expect(cleanText(null, 500)).toBeNull();
    expect(cleanText(["a"], 500)).toBeNull();
    expect(cleanText("ok", 0)).toBeNull();
  });

  it("leaves markup as plain text (it is only ever rendered as text)", () => {
    expect(cleanText("<img src=x onerror=alert(1)>", 500)).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("isWithinJsonSize", () => {
  it("measures serialised size", () => {
    expect(isWithinJsonSize({ a: "x".repeat(10) }, 100)).toBe(true);
    expect(isWithinJsonSize({ a: "x".repeat(200) }, 100)).toBe(false);
  });

  it("rejects what can't be serialised", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(isWithinJsonSize(loop, 1_000)).toBe(false);
    expect(isWithinJsonSize(undefined, 1_000)).toBe(false);
    expect(isWithinJsonSize(BigInt(1), 1_000)).toBe(false);
  });
});
