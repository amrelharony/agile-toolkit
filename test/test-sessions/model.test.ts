/**
 * Test Sessions' model, with the time injected: lengths, the charter
 * sentence, the lenses (Given/When/Then rows first, ranked by words, past
 * ones skipped), the form checks and the split, reading stored rows, the
 * clock (a note's minutes in, when a session ends), the bug a note becomes,
 * a follow-up charter, the unsent bug notes, and the next steps.
 */

import { describe, expect, it } from "vitest";
import type { TestSession, TestSessionNote } from "@/lib/stores/workspace-types";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import {
  EMPTY_CHARTER_DRAFT,
  SESSION_LENGTHS,
  TEST_LENSES,
  chartersByLenses,
  charterSentence,
  clampMinutes,
  followUpFrom,
  minutesIn,
  minutesInText,
  minutesRan,
  nearestLength,
  noteCounts,
  noteToBug,
  normalizeSession,
  pastAreas,
  readSessions,
  runningSession,
  sessionEndsAt,
  testSessionsSteps,
  unsentBugNotes,
  validateCharter,
  validateSplit,
} from "@/lib/test-sessions/model";

const START = "2026-11-20T09:00:00.000Z";

const session = (over: Partial<TestSession> = {}): TestSession => ({
  id: "tsess_a",
  charter: { target: "Saved addresses", toLearn: "whether the list loads" },
  minutes: 60,
  status: "planned",
  notes: [],
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:00.000Z",
  ...over,
});

const note = (over: Partial<TestSessionNote> = {}): TestSessionNote => ({
  id: "n1",
  at: "2026-11-20T09:12:30.000Z",
  kind: "bug",
  text: "The list jumps to the top\nafter picking one.",
  ...over,
});

describe("lengths and the charter", () => {
  it("offers six lengths and rounds any other to the nearest", () => {
    expect(SESSION_LENGTHS).toEqual([15, 30, 45, 60, 90, 120]);
    expect(nearestLength(50)).toBe(45);
    expect(nearestLength(75)).toBe(60);
    expect(nearestLength(200)).toBe(120);
    expect(nearestLength(NaN)).toBe(60);
    expect(clampMinutes(5)).toBe(15);
    expect(clampMinutes(500)).toBe(240);
    expect(clampMinutes("60")).toBeNull();
  });

  it("reads a charter as one sentence in our words", () => {
    expect(
      charterSentence({ target: "checkout", using: "a slow network", toLearn: "what fails." })
    ).toBe("Look at checkout, using a slow network, to learn what fails");
    expect(charterSentence({ target: "checkout", toLearn: "" })).toBe("Look at checkout");
  });
});

describe("charters without AI", () => {
  it("has ten lenses in our own words", () => {
    expect(TEST_LENSES).toHaveLength(10);
    for (const lens of TEST_LENSES) {
      expect(lens.using.length).toBeGreaterThan(5);
      expect(lens.toLearn.length).toBeLessThanOrEqual(300);
    }
  });

  it("puts a charter per Given/When/Then row first, then the lenses by their words", () => {
    const out = chartersByLenses({
      target: "Booking a delivery date",
      details:
        "Given a shopper abroad, when they pick a date, then the price updates.\nDates near midnight matter.",
      count: 3,
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      target: "the price updates",
      using: "changes to a shopper abroad",
    });
    expect(out[1].using).toBe("other dates, times and time zones");
    expect(out[1].why).toMatch(/date/);
    for (const c of out) expect(c.minutes).toBe(60);
  });

  it("skips lenses past charters used, never offers none, and keeps count between 1 and 6", () => {
    const lens = TEST_LENSES.find((l) => l.id === "time")!;
    const out = chartersByLenses({
      target: "Booking a date",
      past: [`Look at booking, using ${lens.using}`],
      count: 9,
    });
    expect(out).toHaveLength(6);
    expect(out.map((c) => c.using)).not.toContain(lens.using);
    const all = chartersByLenses({
      target: "x",
      past: TEST_LENSES.map((l) => l.using),
      count: 0,
    });
    expect(all).toHaveLength(1);
    expect(chartersByLenses({ target: "" })[0].target).toBe("this part of the product");
  });
});

describe("the form checks", () => {
  it("needs what to look at and what to learn, and a length from 15 to 240", () => {
    const blank = validateCharter(EMPTY_CHARTER_DRAFT);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(Object.keys(blank.errors).sort()).toEqual(["target", "toLearn"]);
    const short = validateCharter({
      ...EMPTY_CHARTER_DRAFT,
      target: "x",
      toLearn: "y",
      minutes: "10",
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.minutes).toMatch(/15 minutes to 4 hours/);
    const long = validateCharter({
      ...EMPTY_CHARTER_DRAFT,
      target: "x".repeat(TOOL_TEXT_MAX.short + 1),
      toLearn: "y",
    });
    expect(long.ok).toBe(false);
    const ok = validateCharter({
      ...EMPTY_CHARTER_DRAFT,
      target: "  Saved  addresses ",
      using: " ",
      toLearn: " whether it loads ",
      minutes: "45",
      tester: " Sam ",
      storyId: "story_1",
    });
    expect(ok).toEqual({
      ok: true,
      values: {
        charter: { target: "Saved addresses", toLearn: "whether it loads" },
        minutes: 45,
        tester: "Sam",
        storyId: "story_1",
      },
    });
  });

  it("takes a split of three whole percents adding up to 100, or none", () => {
    expect(validateSplit({ testing: "", bugs: "", setup: "" })).toEqual({ ok: true, values: null });
    expect(validateSplit({ testing: "70", bugs: "20", setup: "10" })).toEqual({
      ok: true,
      values: { testing: 70, bugs: 20, setup: 10 },
    });
    const off = validateSplit({ testing: "70", bugs: "20", setup: "5" });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.errors.total).toMatch(/95%/);
    const bad = validateSplit({ testing: "7.5", bugs: "", setup: "101" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["bugs", "setup", "testing"]);
  });
});

describe("reading stored rows", () => {
  it("keeps a usable row and drops what can't be one", () => {
    const read = normalizeSession({
      id: "s",
      charter: { target: " Checkout ", toLearn: 5 },
      minutes: 9,
      status: "paused",
      coverage: "half",
      split: { testing: 50, bugs: 50, setup: 10 },
      notes: [{ id: "n", at: START, kind: "rant", text: "x" }, { id: "", at: START }, "junk"],
      createdAt: START,
    });
    expect(read).toMatchObject({
      charter: { target: "Checkout", toLearn: "" },
      minutes: 15,
      status: "planned",
      notes: [{ id: "n", kind: "note", text: "x" }],
    });
    expect(read?.coverage).toBeUndefined();
    expect(read?.split).toBeUndefined();
    expect(normalizeSession({ id: "s", charter: { target: "" } })).toBeNull();
  });

  it("lists the newest first and finds the running one", () => {
    const list = readSessions([
      session({ id: "old", createdAt: "2026-11-01T00:00:00Z" }),
      session({
        id: "new",
        createdAt: "2026-11-19T00:00:00Z",
        status: "running",
        startedAt: START,
      }),
    ]);
    expect(list.map((s) => s.id)).toEqual(["new", "old"]);
    expect(runningSession(list)?.id).toBe("new");
  });

  it("keeps each past area once, newest first", () => {
    expect(
      pastAreas([
        session({ area: "Checkout" }),
        session({ area: "checkout" }),
        session({ area: "Search" }),
      ])
    ).toEqual(["Checkout", "Search"]);
  });
});

describe("the clock", () => {
  it("knows when a started session ends and how far in a note was", () => {
    const s = session({ startedAt: START, minutes: 45 });
    expect(sessionEndsAt(s)).toBe(Date.parse(START) + 45 * 60_000);
    expect(sessionEndsAt(session())).toBeNull();
    expect(minutesIn(note(), s)).toBe(12);
    expect(minutesInText(note(), s)).toBe("12 min in");
    expect(minutesInText(note(), session())).toBe("");
    expect(minutesRan({ startedAt: START, endedAt: "2026-11-20T09:50:20.000Z" })).toBe(50);
    expect(minutesRan({ startedAt: START })).toBeNull();
  });
});

describe("what notes become", () => {
  it("makes a bug of a note: its first line, the whole note, the tester, the area and a link back", () => {
    expect(noteToBug(note(), session({ tester: "Priya", area: "Checkout" }))).toEqual({
      title: "The list jumps to the top",
      description: "The list jumps to the top\nafter picking one.",
      raisedBy: "Priya",
      area: "Checkout",
      sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_a" },
    });
    const long = noteToBug(note({ text: "x".repeat(TOOL_TEXT_MAX.capture) }), session());
    expect(long.title).toHaveLength(TOOL_TEXT_MAX.short);
  });

  it("makes a follow-up charter of a question or an idea", () => {
    expect(
      followUpFrom(
        note({ kind: "idea", text: "Try it on a phone\nwhere the list is a sheet" }),
        session({ charter: { target: "Saved addresses", using: "two addresses", toLearn: "x" } })
      )
    ).toEqual({
      target: "Try it on a phone",
      using: "two addresses",
      toLearn: "Try it on a phone\nwhere the list is a sheet",
    });
  });

  it("counts notes by kind and finds the bug notes not sent, or whose bug is gone", () => {
    const s = session({
      notes: [
        note({ id: "a" }),
        note({ id: "b", sentTo: [{ route: "bug", targetId: "bug_1", at: START }] }),
        note({ id: "c", sentTo: [{ route: "bug", targetId: "bug_gone", at: START }] }),
        note({ id: "d", text: "  " }),
        note({ id: "e", kind: "idea" }),
      ],
    });
    expect(noteCounts(s)).toEqual({ note: 0, bug: 4, question: 0, idea: 1 });
    expect(unsentBugNotes(s, (id) => id === "bug_1").map((n) => n.id)).toEqual(["a", "c"]);
    expect(TOOL_LIST_MAX.sessionNotes).toBe(200);
  });
});

describe("next steps", () => {
  const NOW = new Date("2026-11-21T12:00:00.000Z");

  it("has none for an empty or example-only list", () => {
    expect(testSessionsSteps({ sessions: undefined }, NOW)).toEqual([]);
    expect(
      testSessionsSteps(
        { sessions: [session({ id: "example-1", status: "done", notes: [note()] })] },
        NOW
      )
    ).toEqual([]);
  });

  it("asks to log the bugs of a done session not sent yet, linking to it", () => {
    const done = session({
      status: "done",
      startedAt: START,
      endedAt: START,
      notes: [note(), note({ id: "n2" })],
    });
    expect(testSessionsSteps({ sessions: [done] }, NOW)).toEqual([
      expect.objectContaining({
        id: "test-sessions-bugs",
        label: "Log the 2 bugs from “Saved addresses”",
        href: "/test-sessions?session=tsess_a",
      }),
    ]);
    const sent = session({
      status: "done",
      notes: [note({ sentTo: [{ route: "bug", targetId: "bug_1", at: START }] })],
    });
    expect(testSessionsSteps({ sessions: [sent] }, NOW)).toEqual([]);
    // Given the bugs, a note whose bug was deleted counts as not sent.
    expect(testSessionsSteps({ sessions: [sent], bugs: [] }, NOW)[0]?.label).toBe(
      "Log the bug from “Saved addresses”"
    );
  });

  it("asks to finish a session still running a day past its end", () => {
    const stuck = session({
      status: "running",
      startedAt: "2026-11-20T09:00:00.000Z",
      minutes: 60,
    });
    expect(testSessionsSteps({ sessions: [stuck] }, NOW)).toEqual([
      expect.objectContaining({
        id: "test-sessions-stuck",
        label: "Finish or end “Saved addresses”",
      }),
    ]);
    expect(testSessionsSteps({ sessions: [stuck] }, new Date("2026-11-21T09:30:00.000Z"))).toEqual(
      []
    );
  });
});
