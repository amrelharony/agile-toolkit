import { describe, expect, it } from "vitest";
import * as kudosTypes from "@/app/(tools)/kudos/types";
import type { Kudos } from "@/lib/stores/workspace-types";

const { KUDOS_WORD_LIMITS, countWords, isValidKudos, parseKudos } = kudosTypes;

/**
 * What the Kudos tool's types file still holds: the word limits, the word
 * count and the re-exported shape guard. The cards a kudos is drawn as live
 * in lib/kudos/card-designs (test/kudos/card-designs.test.ts).
 */

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

describe("the types file", () => {
  it("no longer carries a theme catalog: the printed cards are the only ones", () => {
    for (const gone of [
      "KUDOS_THEMES",
      "PICKER_THEMES",
      "RETIRED_THEMES",
      "DEFAULT_KUDOS_THEME",
      "getKudosTheme",
      "headerInk",
      "themeInk",
    ]) {
      expect(kudosTypes, gone).not.toHaveProperty(gone);
    }
  });

  it("names the workspace-wide kudos channel", () => {
    expect(kudosTypes.KUDOS_ENTITY_ID).toBe("workspace");
    expect(kudosTypes.KUDOS_TOOL_ID).toBe("kudos");
  });
});

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

  it("still accepts a card saved under an original theme or a custom theme", () => {
    expect(isValidKudos(baseKudos({ theme: "well-done" }))).toBe(true);
    expect(
      isValidKudos(
        baseKudos({ theme: { id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" } })
      )
    ).toBe(true);
  });

  it("is the canonical parser's guard", () => {
    const parsed = parseKudos(baseKudos({ theme: "open-teamwork", episode: 7 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.kudos).toMatchObject({ theme: "open-teamwork", episode: 7 });
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
