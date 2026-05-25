import { describe, expect, it } from "vitest";
import { isValidSession, type Session } from "@/app/(tools)/planning-poker/types";

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC123",
    sessionName: "Sprint 42 planning",
    scale: ["1", "2", "3", "5", "8"],
    scaleType: "fibonacci",
    host: "Alice",
    hostId: "u1",
    participants: [{ id: "u1", name: "Alice", vote: null }],
    stories: [],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

describe("isValidSession", () => {
  it("accepts a well-formed session", () => {
    expect(isValidSession(baseSession())).toBe(true);
  });

  it("accepts a session with multiple participants and stories", () => {
    const s = baseSession({
      participants: [
        { id: "u1", name: "Alice", vote: "5" },
        { id: "u2", name: "Bob", vote: null },
        { id: "u3", name: "Carol", vote: "8" },
      ],
      stories: [
        { id: "s1", title: "User can log in", description: "OAuth flow", finalEstimate: "5" },
        { id: "s2", title: "Password reset", finalEstimate: null },
      ],
      currentStoryIdx: 1,
      revealed: true,
    });
    expect(isValidSession(s)).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isValidSession(null)).toBe(false);
    expect(isValidSession(undefined)).toBe(false);
    expect(isValidSession("a string")).toBe(false);
    expect(isValidSession(42)).toBe(false);
    expect(isValidSession([])).toBe(false);
  });

  it("rejects a missing or oversized room code", () => {
    expect(isValidSession(baseSession({ roomCode: "" }))).toBe(false);
    expect(isValidSession(baseSession({ roomCode: "abc" }))).toBe(false);
    expect(isValidSession(baseSession({ roomCode: "x".repeat(33) }))).toBe(false);
  });

  it("rejects an invalid scaleType", () => {
    expect(
      isValidSession(baseSession({ scaleType: "made-up" as unknown as Session["scaleType"] }))
    ).toBe(false);
  });

  it("rejects oversized text fields (DoS prevention)", () => {
    expect(isValidSession(baseSession({ sessionName: "x".repeat(201) }))).toBe(false);
    expect(isValidSession(baseSession({ host: "x".repeat(81) }))).toBe(false);
    const bigStory = {
      id: "s1",
      title: "x".repeat(501),
      finalEstimate: null,
    };
    expect(isValidSession(baseSession({ stories: [bigStory] }))).toBe(false);
  });

  it("caps participant count and scale size", () => {
    const tooManyParticipants = Array.from({ length: 101 }, (_, i) => ({
      id: `u${i}`,
      name: `User${i}`,
      vote: null,
    }));
    expect(isValidSession(baseSession({ participants: tooManyParticipants }))).toBe(false);

    const tooManyScaleValues = Array.from({ length: 33 }, (_, i) => `${i}`);
    expect(isValidSession(baseSession({ scale: tooManyScaleValues }))).toBe(false);
  });

  it("rejects a participant with a non-null non-string vote", () => {
    const bogus = baseSession({
      participants: [{ id: "u1", name: "Alice", vote: 5 as unknown as string }],
    });
    expect(isValidSession(bogus)).toBe(false);
  });

  it("rejects a story missing required fields", () => {
    const noTitle = baseSession({
      stories: [{ id: "s1", title: "", finalEstimate: null }],
    });
    expect(isValidSession(noTitle)).toBe(false);
  });

  it("rejects non-finite currentStoryIdx", () => {
    expect(isValidSession(baseSession({ currentStoryIdx: NaN }))).toBe(false);
    expect(isValidSession(baseSession({ currentStoryIdx: Infinity }))).toBe(false);
  });
});
