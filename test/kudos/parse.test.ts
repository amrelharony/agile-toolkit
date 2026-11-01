import { describe, it, expect } from "vitest";
import { parseKudos, isValidKudos } from "@/lib/kudos/parse";

const baseLegacy = {
  id: "kud_aaaaaaaaaaaaaaaa",
  theme: "awesome",
  toName: "Alice",
  fromName: "Bob",
  message: "great work today!",
  sentAt: new Date().toISOString(),
};

describe("parseKudos — legacy v1 inputs", () => {
  it("accepts the seven built-in themes", () => {
    for (const theme of [
      "awesome",
      "thank-you",
      "great-job",
      "congratulations",
      "very-happy",
      "you-rock",
      "well-done",
    ]) {
      const r = parseKudos({ ...baseLegacy, theme });
      expect(r.ok, `theme=${theme}`).toBe(true);
    }
  });

  it("stamps version: 1 onto a row missing the version field and flags upgraded=true", () => {
    const r = parseKudos(baseLegacy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.version).toBe(1);
    expect(r.upgraded).toBe(true);
  });

  it("preserves an explicit version: 1 input without flipping to upgraded", () => {
    const r = parseKudos({ ...baseLegacy, version: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.version).toBe(1);
    expect(r.upgraded).toBe(false);
  });

  it("rejects unknown built-in themes (the old string union closed door)", () => {
    const r = parseKudos({ ...baseLegacy, theme: "custom-x" });
    expect(r).toEqual({ ok: false, error: "invalid_theme" });
  });
});

describe("parseKudos — v2 inputs", () => {
  it("accepts a custom-theme object with id/title/emoji/hex", () => {
    const r = parseKudos({
      ...baseLegacy,
      theme: { id: "sapphire-spark", title: "Sapphire Spark", emoji: "💎", hex: "#1e90ff" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.version).toBe(2);
    expect(r.upgraded).toBe(true);
  });

  it("rejects custom themes with bad id, oversize emoji, or non-hex color", () => {
    expect(
      parseKudos({ ...baseLegacy, theme: { id: "Bad ID!", title: "x", emoji: "💎", hex: "#fff" } })
        .ok
    ).toBe(false);
    expect(
      parseKudos({
        ...baseLegacy,
        theme: { id: "x", title: "x", emoji: "💎💎💎💎💎", hex: "#fff" },
      }).ok
    ).toBe(false);
    expect(
      parseKudos({ ...baseLegacy, theme: { id: "x", title: "x", emoji: "💎", hex: "magenta" } }).ok
    ).toBe(false);
  });

  it("accepts sentiment with a known label, finite confidence, and bounded tone tags", () => {
    const r = parseKudos({
      ...baseLegacy,
      sentiment: { label: "positive", confidence: 0.92, tone: ["grateful", "warm"] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.version).toBe(2);
    expect(r.kudos.sentiment?.label).toBe("positive");
  });

  it("rejects sentiment with out-of-range confidence", () => {
    expect(
      parseKudos({ ...baseLegacy, sentiment: { label: "positive", confidence: 1.5, tone: [] } }).ok
    ).toBe(false);
    expect(
      parseKudos({ ...baseLegacy, sentiment: { label: "positive", confidence: -0.1, tone: [] } }).ok
    ).toBe(false);
    expect(
      parseKudos({
        ...baseLegacy,
        sentiment: { label: "positive", confidence: Infinity, tone: [] },
      }).ok
    ).toBe(false);
  });

  it("rejects unknown sentiment labels", () => {
    expect(
      parseKudos({ ...baseLegacy, sentiment: { label: "weird", confidence: 0.5, tone: [] } }).ok
    ).toBe(false);
  });

  it("accepts reactions with bounded emoji and ISO timestamps", () => {
    const r = parseKudos({
      ...baseLegacy,
      reactions: [
        { emoji: "🎉", byProfileId: "p1", at: new Date().toISOString() },
        { emoji: "👏", byProfileId: "p2", at: new Date().toISOString() },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.reactions?.length).toBe(2);
  });

  it("rejects reactions whose `at` doesn't parse", () => {
    const r = parseKudos({
      ...baseLegacy,
      reactions: [{ emoji: "🎉", byProfileId: "p1", at: "yesterday" }],
    });
    expect(r).toEqual({ ok: false, error: "invalid_reactions" });
  });

  it("accepts replyTo and identity hooks", () => {
    const r = parseKudos({
      ...baseLegacy,
      replyTo: "kud_parent",
      senderIdentityId: "avatar-bob",
      recipientIdentityId: "avatar-alice",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.replyTo).toBe("kud_parent");
    expect(r.kudos.version).toBe(2);
  });

  it("keeps toMemberId, the roster member the kudos is for, as a v2 field", () => {
    const r = parseKudos({ ...baseLegacy, toMemberId: "member_alice" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kudos.toMemberId).toBe("member_alice");
    expect(r.kudos.version).toBe(2);
  });

  it("rejects an empty, oversize or non-string toMemberId", () => {
    for (const toMemberId of ["", "m".repeat(65), 7]) {
      expect(parseKudos({ ...baseLegacy, toMemberId })).toEqual({
        ok: false,
        error: "invalid_to_member_id",
      });
    }
  });

  it("rejects fairnessScoreAtSend outside [0,1]", () => {
    expect(parseKudos({ ...baseLegacy, fairnessScoreAtSend: 1.5 }).ok).toBe(false);
    expect(parseKudos({ ...baseLegacy, fairnessScoreAtSend: NaN }).ok).toBe(false);
  });
});

describe("parseKudos — hostile inputs", () => {
  it("rejects non-objects (null, array, primitive)", () => {
    expect(parseKudos(null)).toEqual({ ok: false, error: "not_an_object" });
    expect(parseKudos([])).toEqual({ ok: false, error: "not_an_object" });
    expect(parseKudos("kudos")).toEqual({ ok: false, error: "not_an_object" });
  });

  it("rejects oversize id (> 64 chars)", () => {
    expect(parseKudos({ ...baseLegacy, id: "x".repeat(65) }).ok).toBe(false);
  });

  it("rejects messages over 2000 chars", () => {
    expect(parseKudos({ ...baseLegacy, message: "x".repeat(2001) }).ok).toBe(false);
  });

  it("rejects unparseable sentAt", () => {
    expect(parseKudos({ ...baseLegacy, sentAt: "yesterday afternoon" }).ok).toBe(false);
  });

  it("rejects sentAt more than 5 min in the future (clock-skew bomb)", () => {
    const futureMs = Date.now() + 30 * 60 * 1000;
    expect(parseKudos({ ...baseLegacy, sentAt: new Date(futureMs).toISOString() }).ok).toBe(false);
  });

  it("rejects oversize identity ids", () => {
    expect(parseKudos({ ...baseLegacy, senderIdentityId: "x".repeat(129) }).ok).toBe(false);
  });
});

describe("isValidKudos — boolean compat", () => {
  it("returns true for legacy shapes and false for hostile ones", () => {
    expect(isValidKudos(baseLegacy)).toBe(true);
    expect(isValidKudos(null)).toBe(false);
    expect(isValidKudos({ ...baseLegacy, theme: "custom-x" })).toBe(false);
  });
});
