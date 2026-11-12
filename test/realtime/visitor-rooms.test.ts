import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  VISITOR_CODE_ALPHABET,
  VISITOR_LIMITS,
  VISITOR_ROOM_KIND,
  VISITOR_TOOLS,
  clearVisitorIdentity,
  isVisitorIdentity,
  isVisitorRoomCode,
  isVisitorTool,
  joinUrl,
  newVisitorRoomCode,
  readVisitorIdentity,
  roomNeedsHostKey,
  saveVisitorIdentity,
  visitorChannelName,
  visitorRoomsEnabled,
} from "@/lib/realtime/visitor-rooms";
import { electNewHost, hostMissingLongEnough } from "@/lib/realtime/host-election";
import { electNewHost as pokerElectNewHost } from "@/app/(tools)/planning-poker/merge";

const CODE = "ABCDEFGHJKMN";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("visitorRoomsEnabled", () => {
  it("is on only for exactly '1'", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    expect(visitorRoomsEnabled()).toBe(true);
    for (const v of ["", "0", "true", "on", " 1"]) {
      vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", v);
      expect(visitorRoomsEnabled()).toBe(false);
    }
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", undefined);
    expect(visitorRoomsEnabled()).toBe(false);
  });
});

describe("tools and codes", () => {
  it("allows Planning Poker, Retro, the vote-round tools and the Phase 1 room tools", () => {
    expect(VISITOR_TOOLS).toEqual([
      "planning-poker",
      "retro",
      "health-check",
      "psych-safety",
      "mood-tracker",
      "kano-model",
      "buy-a-feature",
      "hundred-dollar-test",
      "quick-vote",
      "audience-wall",
      "picker",
      "team-mixer",
      "card-decks",
    ]);
    expect(isVisitorTool("retro")).toBe(true);
    expect(isVisitorTool("mood-tracker")).toBe(true);
    expect(isVisitorTool("kano-model")).toBe(true);
    expect(isVisitorTool("hundred-dollar-test")).toBe(true);
    expect(isVisitorTool("audience-wall")).toBe(true);
    expect(isVisitorTool("picker")).toBe(true);
    for (const t of ["canvas", "kudos", "Retro", "", null, 1]) expect(isVisitorTool(t)).toBe(false);
  });

  it("gives every visitor tool its own kind of room", () => {
    expect(VISITOR_ROOM_KIND).toEqual({
      "planning-poker": "poker",
      retro: "retro",
      "health-check": "vote",
      "psych-safety": "vote",
      "mood-tracker": "vote",
      "kano-model": "vote",
      "buy-a-feature": "vote",
      "hundred-dollar-test": "vote",
      "quick-vote": "vote",
      "audience-wall": "wall",
      picker: "show",
      "team-mixer": "show",
      "card-decks": "show",
    });
    expect(Object.keys(VISITOR_ROOM_KIND).sort()).toEqual([...VISITOR_TOOLS].sort());
  });

  it("asks a signed room's link for the host key, and only theirs", () => {
    expect(roomNeedsHostKey("vote")).toBe(true);
    expect(roomNeedsHostKey("show")).toBe(true);
    expect(roomNeedsHostKey("wall")).toBe(true);
    expect(roomNeedsHostKey("poker")).toBe(false);
    expect(roomNeedsHostKey("retro")).toBe(false);
  });

  it("generates 12-character codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newVisitorRoomCode();
      expect(code).toHaveLength(12);
      expect(isVisitorRoomCode(code)).toBe(true);
      for (const ch of code) expect(VISITOR_CODE_ALPHABET).toContain(ch);
    }
  });

  it("uses crypto.getRandomValues and skips bytes that would bias the modulo", () => {
    const spy = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
        const bytes = arr as unknown as Uint8Array;
        // 248..255 are rejected (256 % 31 = 8); then 0, 1, 2, … map to the alphabet in order.
        for (let i = 0; i < bytes.length; i++) bytes[i] = i < 4 ? 250 : i - 4;
        return arr;
      });
    expect(newVisitorRoomCode()).toBe(VISITOR_CODE_ALPHABET.slice(0, 12));
    expect(spy).toHaveBeenCalled();
  });

  it("rejects owner codes and anything malformed", () => {
    for (const c of [
      "ABC123",
      "ABCDEF",
      CODE.toLowerCase(),
      `${CODE}2`,
      "ABCDEFGHJKM0",
      "ABCDEFGHJKMI",
      "",
      null,
      123,
    ]) {
      expect(isVisitorRoomCode(c)).toBe(false);
    }
  });

  it("names channels visitor:<tool>:<code>, or null when invalid", () => {
    expect(visitorChannelName("planning-poker", CODE)).toBe(`visitor:planning-poker:${CODE}`);
    expect(visitorChannelName("retro", CODE)).toBe(`visitor:retro:${CODE}`);
    expect(visitorChannelName("canvas", CODE)).toBeNull();
    expect(visitorChannelName("retro", "ABC123")).toBeNull();
  });

  it("builds /join/<tool>/<code> links, or null when invalid", () => {
    expect(joinUrl("retro", CODE)).toBe(`/join/retro/${CODE}`);
    expect(joinUrl("planning-poker", CODE)).toBe(`/join/planning-poker/${CODE}`);
    expect(joinUrl("retro", "../../x")).toBeNull();
    expect(joinUrl("../admin", CODE)).toBeNull();
  });

  it("has the limits from the design", () => {
    expect(VISITOR_LIMITS.maxMembers).toBe(20);
    expect(VISITOR_LIMITS.keepaliveMs).toBe(30_000);
    expect(VISITOR_LIMITS.maxPayloadChars).toBe(100_000);
    expect(VISITOR_LIMITS.hardTtlMs).toBe(3 * 60 * 60 * 1000);
    expect(VISITOR_LIMITS.idleMs).toBe(30 * 60 * 1000);
  });
});

describe("per-room identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("saves a cleaned name with a fresh 16-character id", () => {
    const id = saveVisitorIdentity(CODE, "  Sam  ");
    expect(id?.name).toBe("Sam");
    expect(id?.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(readVisitorIdentity(CODE)).toEqual(id);
  });

  it("keeps the id on a rename or refresh in the same room", () => {
    const first = saveVisitorIdentity(CODE, "Sam");
    const second = saveVisitorIdentity(CODE, "Samira");
    expect(second?.id).toBe(first?.id);
    expect(readVisitorIdentity(CODE)?.name).toBe("Samira");
  });

  it("uses a different id in another room, so rooms can't be linked", () => {
    const a = saveVisitorIdentity(CODE, "Sam");
    const b = saveVisitorIdentity("ZYXWVUTSRQPN", "Sam");
    expect(a?.id).not.toBe(b?.id);
  });

  it("refuses a bad code or name", () => {
    expect(saveVisitorIdentity("ABC123", "Sam")).toBeNull();
    expect(saveVisitorIdentity(CODE, "   ")).toBeNull();
    expect(saveVisitorIdentity(CODE, "Sam‮")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("ignores tampered storage", () => {
    const key = `agile-toolkit:visitor-room:${CODE}`;
    for (const raw of [
      "not json",
      JSON.stringify({ id: "short", name: "Sam" }),
      JSON.stringify({ id: "a".repeat(16), name: "Sam‮" }),
      JSON.stringify({ id: "a".repeat(16), name: "x".repeat(2000) }),
    ]) {
      sessionStorage.setItem(key, raw);
      expect(readVisitorIdentity(CODE)).toBeNull();
    }
  });

  it("clears the identity", () => {
    saveVisitorIdentity(CODE, "Sam");
    clearVisitorIdentity(CODE);
    expect(readVisitorIdentity(CODE)).toBeNull();
  });

  it("still returns an identity when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(saveVisitorIdentity(CODE, "Sam")?.name).toBe("Sam");
  });

  it("isVisitorIdentity requires a visitor id and an already-clean name", () => {
    expect(isVisitorIdentity({ id: "a".repeat(16), name: "Sam" })).toBe(true);
    expect(isVisitorIdentity({ id: "a".repeat(16), name: " Sam" })).toBe(false);
    expect(isVisitorIdentity({ id: "owner-1", name: "Sam" })).toBe(false);
    expect(isVisitorIdentity(null)).toBe(false);
  });
});

describe("host election", () => {
  const m = (id: string, joinedAt: string) => ({ id, joinedAt });

  it("picks the earliest joiner other than the missing host", () => {
    expect(electNewHost([m("host", "1"), m("b", "3"), m("c", "2")], "host")?.id).toBe("c");
    expect(electNewHost([m("host", "1")], "host")).toBeNull();
    expect(electNewHost([], "host")).toBeNull();
  });

  it("breaks an exact tie by id, whatever the list order", () => {
    const t = "2026-10-19T10:00:00.000Z";
    expect(electNewHost([m("zed", t), m("amy", t)], "host")?.id).toBe("amy");
    expect(electNewHost([m("amy", t), m("zed", t)], "host")?.id).toBe("amy");
  });

  it("is still exported from the poker merge module", () => {
    expect(pokerElectNewHost).toBe(electNewHost);
  });

  it("waits 10 s before migrating", () => {
    expect(hostMissingLongEnough(null, 50_000)).toBe(false);
    expect(hostMissingLongEnough(1_000, 10_999)).toBe(false);
    expect(hostMissingLongEnough(1_000, 11_000)).toBe(true);
  });
});
