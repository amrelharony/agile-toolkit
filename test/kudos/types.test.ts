import { describe, expect, it } from "vitest";
import {
  KUDOS_THEMES,
  KUDOS_WORD_LIMITS,
  countWords,
  getKudosTheme,
  headerInk,
  isValidKudos,
} from "@/app/(tools)/kudos/types";

describe("headerInk", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("gives every built-in header text of at least 4.2:1", () => {
    for (const t of KUDOS_THEMES) {
      expect(contrast(headerInk(t.hex), t.hex), t.id).toBeGreaterThanOrEqual(4.2);
    }
  });

  it("puts dark text on the light headers that white text failed on", () => {
    const ink = Object.fromEntries(KUDOS_THEMES.map((t) => [t.id, headerInk(t.hex)]));
    expect(ink.awesome).toBe("#111111");
    expect(ink["thank-you"]).toBe("#111111");
    expect(ink.congratulations).toBe("#111111");
    expect(ink["very-happy"]).toBe("#111111");
    expect(ink["well-done"]).toBe("#ffffff");
  });

  it("reads 3-digit hex and falls back to white on anything else", () => {
    expect(headerInk("#ff0")).toBe("#111111");
    expect(headerInk("#003")).toBe("#ffffff");
    expect(headerInk("not a colour")).toBe("#ffffff");
  });
});
import type { Kudos } from "@/lib/stores/workspace-types";

function baseKudos(overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: "kud_test123",
    theme: "awesome",
    toName: "Alice",
    fromName: "Amr",
    message: "Thanks for the great review",
    sentAt: "2026-05-27T10:00:00.000Z",
    ...overrides,
  };
}

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("one  two   three")).toBe(3);
  });

  it("returns 0 for empty / whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\t\n")).toBe(0);
  });
});

describe("KUDOS_THEMES catalog", () => {
  it("has 7 themes with stable ids", () => {
    expect(KUDOS_THEMES).toHaveLength(7);
    const ids = KUDOS_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(7);
  });

  it("every theme has a non-empty title + emoji + hex", () => {
    for (const theme of KUDOS_THEMES) {
      expect(theme.title.length).toBeGreaterThan(0);
      expect(theme.emoji.length).toBeGreaterThan(0);
      expect(theme.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("getKudosTheme falls back to the first theme on unknown id", () => {
    expect(getKudosTheme("not-a-theme").id).toBe(KUDOS_THEMES[0].id);
  });

  it("getKudosTheme returns the requested theme when valid", () => {
    expect(getKudosTheme("thank-you").id).toBe("thank-you");
  });
});

describe("KUDOS_WORD_LIMITS", () => {
  it("has sensible caps", () => {
    expect(KUDOS_WORD_LIMITS.message).toBe(50);
    expect(KUDOS_WORD_LIMITS.to).toBeGreaterThanOrEqual(2);
    expect(KUDOS_WORD_LIMITS.from).toBeGreaterThanOrEqual(2);
  });
});

describe("isValidKudos", () => {
  it("accepts a well-formed kudos", () => {
    expect(isValidKudos(baseKudos())).toBe(true);
  });

  it("accepts a kudos with all optional fields populated", () => {
    expect(
      isValidKudos(
        baseKudos({
          toProfileId: "00000000-0000-0000-0000-000000000001",
          fromProfileId: "00000000-0000-0000-0000-000000000002",
          teamName: "Data Governance",
        })
      )
    ).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isValidKudos(null)).toBe(false);
    expect(isValidKudos(undefined)).toBe(false);
    expect(isValidKudos("kudos")).toBe(false);
    expect(isValidKudos(42)).toBe(false);
    expect(isValidKudos([])).toBe(false);
  });

  it("rejects unknown themes (defends against future-version drift)", () => {
    expect(isValidKudos({ ...baseKudos(), theme: "made-up" })).toBe(false);
  });

  it("rejects missing or empty required text fields", () => {
    expect(isValidKudos({ ...baseKudos(), toName: "" })).toBe(false);
    expect(isValidKudos({ ...baseKudos(), fromName: "" })).toBe(false);
    expect(isValidKudos({ ...baseKudos(), message: "" })).toBe(false);
    expect(isValidKudos({ ...baseKudos(), id: "" })).toBe(false);
  });

  it("rejects oversized payloads (DoS prevention)", () => {
    expect(isValidKudos({ ...baseKudos(), id: "x".repeat(65) })).toBe(false);
    expect(isValidKudos({ ...baseKudos(), toName: "x".repeat(81) })).toBe(false);
    expect(isValidKudos({ ...baseKudos(), fromName: "x".repeat(81) })).toBe(false);
    // 2000 chars is the message cap; 2001 is the first invalid length.
    expect(isValidKudos({ ...baseKudos(), message: "x".repeat(2001) })).toBe(false);
  });

  it("rejects non-string fields", () => {
    expect(isValidKudos({ ...baseKudos(), toName: 42 as unknown as string })).toBe(false);
    expect(isValidKudos({ ...baseKudos(), sentAt: 42 as unknown as string })).toBe(false);
  });

  it("rejects malformed optional fields when present", () => {
    expect(
      isValidKudos({
        ...baseKudos(),
        toProfileId: 42 as unknown as string,
      })
    ).toBe(false);
    expect(
      isValidKudos({
        ...baseKudos(),
        teamName: "x".repeat(81),
      })
    ).toBe(false);
  });

  it("preserves the 'absent vs invalid' distinction for optional fields", () => {
    // Absent => OK. Strip the optional keys explicitly so the validator
    // sees a payload where each is undefined-as-missing rather than
    // present-as-null.
    const full = baseKudos({ toProfileId: "p1", fromProfileId: "p2", teamName: "team" });
    const minimal: Record<string, unknown> = { ...full };
    delete minimal.toProfileId;
    delete minimal.fromProfileId;
    delete minimal.teamName;
    expect(isValidKudos(minimal)).toBe(true);
  });
});
