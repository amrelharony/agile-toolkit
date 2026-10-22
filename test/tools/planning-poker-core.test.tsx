import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { castVotes, isNumeric, sortVotes, withRound } from "@/app/(tools)/planning-poker/rounds";
import { preserveHostOnlyFields } from "@/app/(tools)/planning-poker/merge";
import { playerKey } from "@/app/(tools)/planning-poker/players";
import {
  LOCAL_SESSION_KEY,
  adoptLocalSession,
  clearLocalSession,
  loadLocalSession,
  saveLocalSession,
} from "@/app/(tools)/planning-poker/local-session";
import { buildExample, isExampleSession } from "@/app/(tools)/planning-poker/example";
import {
  isVisitorRoomSession,
  toVisitorWire,
  withHostOnly,
} from "@/app/(tools)/planning-poker/visitor-session";
import { toMarkdown } from "@/app/(tools)/planning-poker/markdown";
import {
  MAX_ROUNDS,
  isValidSession,
  type Session,
  type Story,
} from "@/app/(tools)/planning-poker/types";

/**
 * Planning Poker: the pure helpers no other suite reaches — vote sorting and
 * round history, the host-only merge guard, the local-session store, the
 * visitor-room wire rules, and the Markdown export's less common paths.
 */

const NOW = new Date(2026, 9, 18);
const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];
const TSHIRT = ["XS", "S", "M", "L", "XL", "XXL", "?"];

function session(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: [...FIB],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: "me",
    participants: [{ id: "me", name: "Scrum Master", vote: null }],
    stories: [],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

function story(id: string, overrides: Partial<Story> = {}): Story {
  return { id, title: `Story ${id}`, finalEstimate: null, ...overrides };
}

// Visitor-room member ids are nanoid(16).
const V_HOST = "hostAAAAAAAAAAAA";
const V_ANA = "anaAAAAAAAAAAAAA";

function visitorSession(overrides: Partial<Session> = {}): Session {
  return session({
    roomCode: "ROOMCODE2345",
    hostId: V_HOST,
    participants: [
      { id: V_HOST, name: "Host", vote: null },
      { id: V_ANA, name: "Ana", vote: "5" },
    ],
    stories: [story("s1", { description: "Line one\nLine two\tTabbed" })],
    ...overrides,
  });
}

describe("isNumeric", () => {
  it("accepts integers, decimals, negatives and padded numbers", () => {
    for (const v of ["0", "1", "13", "0.5", "-1", " 5 "]) expect(isNumeric(v)).toBe(true);
  });

  it("rejects the special cards, blanks, sizes and number-like junk", () => {
    for (const v of [
      "?",
      "∞",
      "",
      "   ",
      "M",
      "XL",
      "1e3",
      ".5",
      "1.",
      "5pts",
      "NaN",
      "Infinity",
    ]) {
      expect(isNumeric(v)).toBe(false);
    }
  });
});

describe("sortVotes", () => {
  it("puts numbers first in numeric (not string) order, then the rest in scale order", () => {
    expect(sortVotes(["13", "?", "2", "∞", "21", "3"], FIB)).toEqual([
      "2",
      "3",
      "13",
      "21",
      "?",
      "∞",
    ]);
  });

  it("orders T-shirt sizes by the scale, not alphabetically", () => {
    expect(sortVotes(["XL", "S", "?", "M", "XS"], TSHIRT)).toEqual(["XS", "S", "M", "XL", "?"]);
  });

  it("puts a card that isn't on the scale after every card that is", () => {
    expect(sortVotes(["Huge", "?", "XS"], TSHIRT)).toEqual(["XS", "?", "Huge"]);
  });

  it("keeps ties and doesn't touch its input", () => {
    const votes = ["5", "3", "5", "3"];
    expect(sortVotes(votes, FIB)).toEqual(["3", "3", "5", "5"]);
    expect(votes).toEqual(["5", "3", "5", "3"]);
    expect(sortVotes([], FIB)).toEqual([]);
  });
});

describe("castVotes", () => {
  it("drops empty seats, blank votes and the pre-reveal sentinel", () => {
    expect(
      castVotes([
        { id: "a", name: "A", vote: "5" },
        { id: "b", name: "B", vote: null },
        { id: "c", name: "C", vote: "  " },
        { id: "d", name: "D", vote: "•" },
        { id: "e", name: "E", vote: "?" },
      ])
    ).toEqual(["5", "?"]);
    expect(castVotes([])).toEqual([]);
  });
});

describe("withRound", () => {
  it("records the round sorted low to high, after any earlier ones", () => {
    const s = withRound(story("a", { rounds: [["3", "5"]] }), ["8", "?", "5"], FIB);
    expect(s.rounds).toEqual([
      ["3", "5"],
      ["5", "8", "?"],
    ]);
  });

  it("starts a history on a story that had none", () => {
    expect(withRound(story("a"), ["2"], FIB).rounds).toEqual([["2"]]);
  });

  it("leaves the story as it was when nobody voted", () => {
    const s = story("a");
    expect(withRound(s, [], FIB)).toBe(s);
  });

  it(`keeps only the last ${MAX_ROUNDS} rounds, so the session stays valid`, () => {
    let s = story("a");
    for (let i = 1; i <= MAX_ROUNDS + 2; i++) s = withRound(s, [String(i)], FIB);
    expect(s.rounds).toHaveLength(MAX_ROUNDS);
    expect(s.rounds![0]).toEqual(["3"]);
    expect(s.rounds!.at(-1)).toEqual([String(MAX_ROUNDS + 2)]);
    expect(isValidSession(session({ stories: [s] }))).toBe(true);
  });

  it("doesn't mutate the story it was given", () => {
    const before = story("a", { rounds: [["1"]] });
    withRound(before, ["2"], FIB);
    expect(before.rounds).toEqual([["1"]]);
  });
});

describe("preserveHostOnlyFields", () => {
  it("takes the peer's participants but keeps every host-only field", () => {
    const prev = session({
      stories: [story("a")],
      revealed: true,
      currentStoryIdx: 0,
      sessionName: "Real name",
    });
    const next = session({
      roomCode: "HACKED",
      sessionName: "Hijacked",
      scale: ["1", "1000"],
      scaleType: "custom",
      host: "Mallory",
      hostId: "mallory",
      stories: [],
      revealed: false,
      currentStoryIdx: 3,
      participants: [
        { id: "me", name: "Scrum Master", vote: null },
        { id: "p2", name: "Peer", vote: "5" },
      ],
    });
    const out = preserveHostOnlyFields(prev, next);
    expect(out.participants).toEqual(next.participants);
    expect(out).toMatchObject({
      roomCode: "ABC234",
      sessionName: "Real name",
      scale: FIB,
      scaleType: "fibonacci",
      host: "Scrum Master",
      hostId: "me",
      stories: prev.stories,
      revealed: true,
      currentStoryIdx: 0,
    });
  });
});

describe("playerKey", () => {
  it("matches names ignoring case, edge spaces and runs of whitespace", () => {
    expect(playerKey("  Ana   Lee ")).toBe("ana lee");
    expect(playerKey("ANA\tLEE")).toBe(playerKey("ana lee"));
    expect(playerKey("")).toBe("");
  });
});

describe("local session storage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a saved session and clears it", () => {
    const s = session({ stories: [story("a", { finalEstimate: "5" })] });
    saveLocalSession(s);
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).not.toBeNull();
    expect(loadLocalSession()).toEqual(s);
    clearLocalSession();
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    expect(loadLocalSession()).toBeNull();
  });

  it("refuses corrupt JSON, an invalid session and an oversized blob", () => {
    window.localStorage.setItem(LOCAL_SESSION_KEY, "{not json");
    expect(loadLocalSession()).toBeNull();
    window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ roomCode: "x" }));
    expect(loadLocalSession()).toBeNull();
    window.localStorage.setItem(LOCAL_SESSION_KEY, "x".repeat(4_000_001));
    expect(loadLocalSession()).toBeNull();
  });

  it("never throws when storage is blocked or full", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadLocalSession()).toBeNull();
    expect(() => saveLocalSession(session())).not.toThrow();
    expect(() => clearLocalSession()).not.toThrow();
  });

  it("re-keys a restored session's host seat to this browser's id", () => {
    const stored = session({
      hostId: "old-id",
      participants: [
        { id: "old-id", name: "Scrum Master", vote: "5" },
        { id: "p2", name: "Ana", vote: null },
      ],
    });
    const adopted = adoptLocalSession(stored, "new-id");
    expect(adopted.hostId).toBe("new-id");
    expect(adopted.participants).toEqual([
      { id: "new-id", name: "Scrum Master", vote: "5" },
      { id: "p2", name: "Ana", vote: null },
    ]);
    expect(stored.hostId).toBe("old-id");
    // Same identity: handed back as-is.
    expect(adoptLocalSession(stored, "old-id")).toBe(stored);
  });
});

describe("isExampleSession", () => {
  it("spots the example, or a session still holding one of its stories", () => {
    expect(isExampleSession(null)).toBe(false);
    expect(isExampleSession(session())).toBe(false);
    expect(isExampleSession(buildExample("me"))).toBe(true);
    const ex = buildExample("me");
    expect(isExampleSession(session({ stories: [story("mine"), ex.stories[0]] }))).toBe(true);
    expect(isExampleSession(session({ stories: [story("mine")] }))).toBe(false);
  });
});

describe("visitor room wire rules", () => {
  it("accepts a clean session for this room, line breaks in descriptions included", () => {
    const s = visitorSession();
    expect(isVisitorRoomSession(s, "ROOMCODE2345")).toBe(true);
    expect(toVisitorWire(s)).toBe(s);
  });

  it("refuses another room, foreign ids and too many people", () => {
    expect(isVisitorRoomSession(visitorSession(), "OTHERROOM234")).toBe(false);
    expect(isVisitorRoomSession(visitorSession({ hostId: "me" }), "ROOMCODE2345")).toBe(false);
    const stranger = visitorSession({
      participants: [
        { id: V_HOST, name: "Host", vote: null },
        { id: "player-1", name: "Guest", vote: null },
      ],
    });
    expect(isVisitorRoomSession(stranger, "ROOMCODE2345")).toBe(false);
    const crowd = visitorSession({
      participants: Array.from({ length: 21 }, (_, i) => ({
        id: `member${String(i).padStart(10, "0")}`,
        name: `P${i}`,
        vote: null,
      })),
    });
    expect(isVisitorRoomSession(crowd, "ROOMCODE2345")).toBe(false);
  });

  it("refuses control and bidi characters in any rendered text", () => {
    const RLO = "‮";
    const cases: Partial<Session>[] = [
      { sessionName: `Sprint${RLO}` },
      { host: `Ho${RLO}st` },
      { scale: ["1", `2${RLO}`] },
      {
        participants: [
          { id: V_HOST, name: "Host", vote: null },
          { id: V_ANA, name: `A${RLO}na`, vote: null },
        ],
      },
      {
        participants: [
          { id: V_HOST, name: "Host", vote: null },
          { id: V_ANA, name: "Ana", vote: `5${RLO}` },
        ],
      },
      { stories: [story("s1", { title: `Bad\ntitle` })] },
      { stories: [story("s1", { description: `Bell\u0007` })] },
      { stories: [story("s1", { finalEstimate: `8${RLO}` })] },
      { stories: [story("s1", { rounds: [["3", `5${RLO}`]] })] },
    ];
    for (const over of cases) {
      expect(isVisitorRoomSession(visitorSession(over), "ROOMCODE2345")).toBe(false);
    }
  });

  it("strips hidden characters before sending, with fallbacks for fields left empty", () => {
    const RLM = "‏";
    const dirty = visitorSession({
      sessionName: `Sprint${RLM} 14`,
      host: RLM,
      participants: [
        { id: V_HOST, name: "Host", vote: null },
        { id: V_ANA, name: `${RLM}`, vote: `5${RLM}` },
      ],
      stories: [
        story("s1", {
          title: "\u0007",
          description: `Line one\nLine\u0000 two\tend${RLM}`,
          finalEstimate: `8${RLM}`,
          rounds: [["3", RLM]],
        }),
      ],
    });
    const wire = toVisitorWire(dirty);
    expect(wire).not.toBe(dirty);
    expect(wire.sessionName).toBe("Sprint 14");
    expect(wire.host).toBe("Host");
    expect(wire.participants[1]).toEqual({ id: V_ANA, name: "Player", vote: "5" });
    expect(wire.stories[0]).toMatchObject({
      title: "Untitled story",
      description: "Line one\nLine two\tend",
      finalEstimate: "8",
      rounds: [["3", "?"]],
    });
    // What it sends, every receiver accepts.
    expect(isVisitorRoomSession(wire, "ROOMCODE2345")).toBe(true);
    // The original isn't touched.
    expect(dirty.host).toBe(RLM);
  });

  it("keeps only the host's seat for storage", () => {
    const s = visitorSession();
    expect(withHostOnly(s).participants).toEqual([{ id: V_HOST, name: "Host", vote: null }]);
    const alone = visitorSession({ participants: [{ id: V_HOST, name: "Host", vote: null }] });
    expect(withHostOnly(alone)).toBe(alone);
  });
});

describe("Planning Poker toMarkdown: less common paths", () => {
  it("shows the live votes of a revealed round, sorted, instead of the last recorded one", () => {
    const md = toMarkdown(
      session({
        participants: [
          { id: "me", name: "Scrum Master", vote: "8" },
          { id: "p2", name: "Ana", vote: "3" },
          { id: "p3", name: "Lee", vote: null },
        ],
        stories: [story("a", { title: "Live", rounds: [["1", "2"]] })],
        revealed: true,
      }),
      NOW
    );
    expect(md).toContain("| Live | — | 3, 8 |");
  });

  it("falls back to the recorded round when the revealed table is empty", () => {
    const md = toMarkdown(
      session({
        stories: [story("a", { title: "Recorded", finalEstimate: "2", rounds: [["1", "2"]] })],
        revealed: true,
      }),
      NOW
    );
    expect(md).toContain("| Recorded | 2 | 1, 2 |");
  });

  it("doesn't show face-down votes before the reveal", () => {
    const md = toMarkdown(
      session({
        participants: [{ id: "me", name: "Scrum Master", vote: "13" }],
        stories: [story("a", { title: "Hidden" })],
        revealed: false,
      }),
      NOW
    );
    expect(md).toContain("| Hidden | — | — |");
    expect(md).not.toContain("13");
  });

  it("adds decimal points without float noise, and says '1 point'", () => {
    const halves = toMarkdown(
      session({
        scale: ["0.1", "0.2", "1"],
        scaleType: "custom",
        stories: [story("a", { finalEstimate: "0.1" }), story("b", { finalEstimate: "0.2" })],
      }),
      NOW
    );
    expect(halves).toContain("Custom scale, 1 participant.");
    expect(halves).toContain("**Total: 0.3 points** (2 of 2 stories estimated)");
    const one = toMarkdown(session({ stories: [story("a", { finalEstimate: "1" })] }), NOW);
    expect(one).toContain("**Total: 1 point** (1 of 1 story estimated)");
  });

  it("says 0 points while nothing is estimated yet", () => {
    const md = toMarkdown(session({ stories: [story("a"), story("b")] }), NOW);
    expect(md).toContain("**Total: 0 points** (0 of 2 stories estimated)");
  });

  it("tallies instead of adding when a '?' or '∞' was agreed", () => {
    const md = toMarkdown(
      session({
        stories: [
          story("a", { finalEstimate: "5" }),
          story("b", { finalEstimate: "?" }),
          story("c", { finalEstimate: "3" }),
        ],
      }),
      NOW
    );
    expect(md).toContain("**Estimated:** 3 ×1, 5 ×1, ? ×1 (3 of 3 stories estimated)");
  });

  it("lists a re-voted story that isn't agreed yet, on one line", () => {
    const md = toMarkdown(
      session({
        sessionName: "Refinement\nweek 2",
        stories: [
          story("a", {
            title: "Split\nstory",
            rounds: [
              ["1", "13"],
              ["5", "8"],
            ],
          }),
        ],
      }),
      NOW
    );
    expect(md.split("\n")[0]).toBe("# Planning Poker — 18 Oct 2026 (Refinement week 2)");
    expect(md).toContain("## Re-voted\n\n- **Split story**: 1, 13 → 5, 8 (not agreed yet)");
  });

  it("escapes pipes in an estimate and in votes", () => {
    const md = toMarkdown(
      session({
        scale: ["a|b", "c"],
        scaleType: "custom",
        stories: [story("a", { title: "Odd", finalEstimate: "a|b", rounds: [["a|b", "c"]] })],
      }),
      NOW
    );
    expect(md).toContain("| Odd | a\\|b | a\\|b, c |");
  });
});
