import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { retroFormats } from "@/lib/constants/retro-formats";
import { addDays } from "@/lib/impediments/model";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import type { RetroFacts } from "@/lib/retro/facts";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { todayIso } from "@/lib/sprints/series";
import { sayDoRatio } from "@/lib/sprints/metrics";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  Kudos,
  MoodEntry,
  RetroBoard,
  RetroCard,
  Sprint,
  SprintGoal,
  Story,
} from "@/lib/stores/workspace-types";

/**
 * Retro, Phase 4: the board names the sprint it looks back on (picked, never
 * set behind the team's back), opens with that sprint's facts from the other
 * tools, shows the words its cards share instead of k-means "themes", seeds
 * the appreciations column from the sprint's kudos, picks owners from the
 * roster (saved once, when the field is left), validates a new card, and
 * lets New Retro be undone — saying which past retro drops off at the limit.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const ai = vi.hoisted(() => ({ prompts: [] as { prompt: string }[] }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { prompt: string }[] } }) => {
    ai.prompts = config.prompts;
    return null;
  },
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log, toolRunId: "test-run" }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});

import { RetroClient } from "@/app/(tools)/retro/retro-client";
import { EXAMPLE_FACTS, buildExample } from "@/app/(tools)/retro/example";
import { withClosedSprintSayDo } from "@/app/(tools)/retro/use-board-facts";
import { closeSprint } from "@/app/(tools)/sprint/close";
import { factLines } from "@/app/(tools)/retro/facts-text";
import { kudosCardText, kudosCards } from "@/app/(tools)/retro/kudos";
import { toMarkdown } from "@/app/(tools)/retro/markdown";
import {
  THEME_MIN_CARDS,
  cardWords,
  keywordThemes,
  stem,
  themeCardCount,
  themesForPrompt,
} from "@/app/(tools)/retro/themes";
import { retroVerdict } from "@/app/(tools)/retro/verdict";
import { boardBeforeNewRetro, RETRO_ARCHIVE_LIMIT } from "@/app/(tools)/retro/archive";
import { validateCardText } from "@/app/(tools)/retro/components/retro-column-panel";

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, n);
const startStop = retroFormats[0]; // Start / Stop / Continue
const madSadGlad = retroFormats.find((f) => f.id === "mad-sad-glad")!;

// Sprint 12 ended two days ago (its retro window is open); Sprint 13 started yesterday.
const S1: Sprint = {
  id: "s1",
  name: "Sprint 12",
  startDate: day(-15),
  endDate: day(-2),
  pointsPlanned: 20,
  pointsCompleted: 5,
  status: "completed",
};
const S2: Sprint = {
  id: "s2",
  name: "Sprint 13",
  startDate: day(-1),
  endDate: day(12),
  pointsPlanned: 0,
  status: "active",
};

function card(id: string, columnKey: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey,
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

function board(id: string, overrides: Partial<RetroBoard> = {}): RetroBoard {
  return {
    id,
    format: startStop,
    phase: "write",
    cards: [],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

const ARCHIVE_AT = `${day(-16)}T15:00:00.000Z`;
const lastRetro = () =>
  board(`retro:${ARCHIVE_AT}`, {
    archivedAt: ARCHIVE_AT,
    phase: "actions",
    cards: [
      card("a1", "start", { text: "Pair on reviews", isActionItem: true, done: true }),
      card("a2", "stop", { text: "Stop late merges", isActionItem: true }),
    ],
  });

const stories: Story[] = [
  { id: "st1", title: "Saved cards", points: 5, status: "done", sprintId: "s1", doneAt: day(-3) },
  { id: "st2", title: "Receipts", points: 3, status: "in_progress", sprintId: "s1" },
];
const goals: SprintGoal[] = [
  {
    id: goalDocId("s1"),
    businessObjective: "",
    goal: "Ship saved cards",
    criteria: [],
    keyResults: [],
    sprintId: "s1",
    outcome: { met: "not-met", decidedAt: `${day(-2)}T16:00:00.000Z` },
  },
];
const impediments: Impediment[] = [
  {
    id: "i1",
    title: "CI down",
    severity: "high",
    raisedAt: day(-10),
    resolvedAt: day(-8),
    source: "manual",
  },
  { id: "i2", title: "No test env", severity: "medium", raisedAt: day(-5), source: "manual" },
];
const moodEntries: MoodEntry[] = [
  { id: "m1", memberId: "u1", date: day(-9), score: 4 },
  { id: "m2", memberId: "u2", date: day(-8), score: 2 },
];
const kudos: Kudos[] = [
  {
    id: "k1",
    theme: "thank-you",
    toName: "Sam",
    fromName: "Priya",
    message: "Fixed the flaky tests",
    sentAt: `${day(-6)}T10:00:00.000Z`,
  },
  {
    id: "k2",
    theme: "great-job",
    toName: "Dev",
    fromName: "Sam",
    message: "Great demo",
    sentAt: `${day(-4)}T10:00:00.000Z`,
  },
  {
    id: "k3",
    theme: "awesome",
    toName: "Old",
    fromName: "News",
    message: "Before the sprint",
    sentAt: `${day(-40)}T10:00:00.000Z`,
  },
];

const ws = () => useWorkspaceStore.getState();
const current = () => ws().retroBoards?.find((b) => b.id === "retro:current");
const archives = () => (ws().retroBoards ?? []).filter((b) => b.archivedAt);
const seedBoards = (...boards: RetroBoard[]) => useWorkspaceStore.setState({ retroBoards: boards });
const logged = (action: string) => history.log.mock.calls.filter(([a]) => a === action);
const lastUndo = () => {
  const call = toastSpy.mock.calls.at(-1);
  if (!call) throw new Error("no toast");
  return call[1].action.onClick as () => void;
};
const announced = () => screen.getByTestId("live-polite");

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <RetroClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Pick a sprint in "Retro for" by the start of its name ("Sprint 13 · 23 Oct – …"). */
function chooseSprint(name: string) {
  const trigger = screen.getByRole("combobox", { name: "Retro for" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(
    within(screen.getByRole("listbox")).getByRole("option", { name: new RegExp(`^${name} ·`) })
  );
}

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockClear();
  exported.markdown = undefined;
  ai.prompts = [];
  localStorage.clear();
  useWorkspaceStore.setState({
    retroBoards: [],
    sprints: [S1, S2],
    stories,
    sprintGoals: goals,
    impediments,
    moodEntries,
    kudos,
    kanbanBoards: [],
    teamMembers: [],
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("common words (keyword grouping)", () => {
  const cards = (texts: string[]) => texts.map((t, i) => card(`c${i}`, "start", { text: t }));

  it("stems a team's spellings of one word together", () => {
    expect(["tests", "testing", "tested", "test"].map(stem)).toEqual(Array(4).fill("test"));
    expect(["merge", "merges", "merged", "merging"].map(stem)).toEqual(Array(4).fill("merg"));
    expect(["stories", "story"].map(stem)).toEqual(["story", "story"]);
    expect(["planned", "planning", "plan"].map(stem)).toEqual(["plan", "plan", "plan"]);
    expect(stem("process")).toBe("process");
    expect(stem("status")).toBe("status");
  });

  it("drops stop words, retro filler, numbers and short words", () => {
    expect(cardWords("We need to START doing 2 more reviews, it's the team's job")).toEqual([
      "reviews",
      "job",
    ]);
    expect(cardWords("")).toEqual([]);
  });

  it("groups cards by a word two or more share, biggest first, each card once", () => {
    const themes = keywordThemes(
      cards([
        "Flaky UI tests",
        "The flaky deploy job",
        "Tests are flaky on CI",
        "Deploys take an hour",
        "Long standups",
        "Pairing on reviews",
        "Code reviews were slow",
        "Docs are out of date",
        "Demo went well",
        "Onboarding guide",
      ])
    );
    expect(themes.map((t) => [t.keyword, t.cardIds])).toEqual([
      ["flaky", ["c0", "c1", "c2"]],
      ["reviews", ["c5", "c6"]],
    ]);
    // "tests" (c0, c2) and "deploy" (c1, c3) lost their cards to "flaky".
  });

  it("counts a grouped card with its parent, and adds the group's votes", () => {
    const board = [
      card("p", "stop", { text: "Late merges", votes: 2 }),
      card("child", "stop", { text: "Merging after the freeze", votes: 1, groupedWith: "p" }),
      card("q", "stop", { text: "Merge conflicts every day", votes: 4 }),
      card("x1", "start", { text: "Retro snacks" }),
      card("x2", "start", { text: "Office plants" }),
    ];
    const [merge] = keywordThemes(board);
    // "merges", "merging" and "merge" once each: the shortest spelling shows.
    expect(merge).toEqual({
      keyword: "merge",
      cardIds: ["q", "p"],
      usedBy: ["q", "p"],
      votes: 7,
    });
    expect(themeCardCount(board)).toBe(4);
  });

  it("quotes the grouped card that uses a word, not its parent", () => {
    const board = [
      card("p", "stop", { text: "Release day chaos", votes: 2 }),
      card("child", "stop", { text: "Flaky deploys", groupedWith: "p" }),
      card("q", "stop", { text: "Flaky tests" }),
      card("x1", "start", { text: "Retro snacks" }),
      card("x2", "start", { text: "Office plants" }),
    ];
    const [flaky] = keywordThemes(board);
    expect(flaky).toMatchObject({ keyword: "flaky", cardIds: ["p", "q"], usedBy: ["child", "q"] });
    expect(themesForPrompt([flaky], board)).toEqual([
      { keyword: "flaky", cards: ["Flaky deploys", "Flaky tests"] },
    ]);
    const md = toMarkdown({ format: startStop, cards: board }, new Date(2026, 9, 18), {
      themes: [flaky],
    });
    expect(md).toContain("- flaky (2 cards): Flaky deploys; Flaky tests\n");
    expect(md).not.toContain("(2 cards): Release day chaos");
  });

  it("reads words in any script, with either apostrophe", () => {
    expect(cardWords("Réunion trop longue, réunion inutile")).toEqual([
      "réunion",
      "trop",
      "longue",
      "réunion",
      "inutile",
    ]);
    expect(cardWords("Тесты падают на CI")).toEqual(["тесты", "падают"]);
    expect(cardWords("The team’s demo")).toEqual(["demo"]);
    const themes = keywordThemes(
      ["Réunion trop longue", "Une réunion de plus", "Café", "Musique", "Plantes"].map((t, i) =>
        card(`f${i}`, "start", { text: t })
      )
    );
    expect(themes.map((t) => [t.keyword, t.cardIds])).toEqual([["réunion", ["f0", "f1"]]]);
  });

  it("leaves out a word most cards use, and boards too small to group", () => {
    expect(keywordThemes(cards(["Slow builds", "Slow reviews", "Slow deploys"]))).toEqual([]);
    expect(keywordThemes(cards(["Only one card"]))).toEqual([]);
    expect(keywordThemes([])).toEqual([]);
    expect(keywordThemes(cards(["a b", "a b"]), { maxThemes: 0 })).toEqual([]);
  });

  it("handles a huge board and caps the themes", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      card(`h${i}`, "start", { text: `topic${i % 20} detail${i % 7} unique${i}` })
    );
    const themes = keywordThemes(many, { maxThemes: 5 });
    expect(themes).toHaveLength(5);
    const seen = themes.flatMap((t) => t.cardIds);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("gives the AI prompt each word with its cards' text", () => {
    const board = cards(["Flaky tests", "Flaky deploys", "x", "y", "z"]);
    expect(themesForPrompt(keywordThemes(board), board)).toEqual([
      { keyword: "flaky", cards: ["Flaky tests", "Flaky deploys"] },
    ]);
    expect(THEME_MIN_CARDS).toBe(10);
  });

  it("walks a group two deep to its top card and survives a loop", () => {
    const loop = [
      card("a", "start", { text: "Flaky one", groupedWith: "b" }),
      card("b", "start", { text: "Flaky two", groupedWith: "a" }),
      card("c", "start", { text: "Flaky three" }),
      card("d", "start", { text: "Flaky four", groupedWith: "c" }),
      card("e", "start", { text: "Flaky five", groupedWith: "d" }),
      card("f", "start", { text: "other" }),
      card("g", "start", { text: "thing else" }),
      card("h", "start", { text: "Snacks" }),
      card("i", "start", { text: "Plants" }),
      card("j", "start", { text: "Music" }),
    ];
    // a and b point at each other: each counts on its own; d and e count with c.
    expect(themeCardCount(loop)).toBe(8);
    expect(keywordThemes(loop)[0].cardIds.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("the verdict", () => {
  const fmt = startStop;

  it("counts cards and names the sprint's goal outcome while writing", () => {
    const state = {
      format: fmt,
      phase: "write" as const,
      cards: [card("a", "start"), card("b", "stop"), card("c", "stop", { groupedWith: "b" })],
    };
    expect(retroVerdict(state)).toBe("2 cards in 2 columns.");
    expect(
      retroVerdict(state, {
        sprintName: "Sprint 12",
        goalOutcome: { met: "partly", decidedAt: "x" },
      })
    ).toBe("2 cards in 2 columns; Sprint 12 partly met its goal.");
    expect(
      retroVerdict({ ...state, cards: [] }, { sprintName: "Sprint 12", goalOutcome: null })
    ).toBe("No cards yet: start with what happened in Sprint 12.");
    expect(retroVerdict({ ...state, cards: [] })).toBe(
      "No cards yet: start with what happened since the last retro."
    );
  });

  it("names the leader while voting and what to discuss first", () => {
    const cards = [
      card("a", "start", { text: "Flaky tests", votes: 4 }),
      card("b", "stop", { text: "Late merges", votes: 2 }),
    ];
    expect(retroVerdict({ format: fmt, phase: "vote", cards })).toBe(
      "6 votes cast; “Flaky tests” leads with 4."
    );
    expect(retroVerdict({ format: fmt, phase: "vote", cards: [card("a", "start")] })).toBe(
      "No votes yet: each person has 3 votes for the cards that matter most."
    );
    expect(retroVerdict({ format: fmt, phase: "discuss", cards })).toBe(
      "Discuss “Flaky tests” first (4 votes)."
    );
    const tie = [...cards, card("c", "continue", { text: "Mob reviews", votes: 4 })];
    expect(retroVerdict({ format: fmt, phase: "discuss", cards: tie })).toBe(
      "“Flaky tests” and “Mob reviews” tie at 4 votes: start with either."
    );
    expect(retroVerdict({ format: fmt, phase: "discuss", cards: [card("a", "start")] })).toBe(
      "Nobody voted, so discuss the cards in the order the team picks."
    );
  });

  it("counts actions and the ones without an owner", () => {
    const cards = [
      card("a", "start", { isActionItem: true, assignee: "Sam" }),
      card("b", "stop", { isActionItem: true }),
      card("c", "stop"),
    ];
    expect(retroVerdict({ format: fmt, phase: "actions", cards })).toBe(
      "2 actions agreed, 1 without an owner."
    );
    expect(retroVerdict({ format: fmt, phase: "actions", cards: cards.slice(0, 1) })).toBe(
      "1 action agreed, each with an owner."
    );
    expect(retroVerdict({ format: fmt, phase: "actions", cards: [] })).toBe(
      "No actions agreed yet: mark the cards the team will act on."
    );
  });
});

describe("the facts as sentences", () => {
  const base: RetroFacts = {
    ...EXAMPLE_FACTS,
    sprintId: "s9",
    sprintName: "Sprint 9",
  };
  const sentence = (f: RetroFacts, key: string) =>
    factLines(f).find((l) => l.key === key)?.sentence;

  it("says each fact plainly and links to its tool", () => {
    const lines = factLines(base);
    expect(lines.map((l) => l.key)).toEqual([
      "goal",
      "sayDo",
      "burndown",
      "impediments",
      "mood",
      "followThrough",
      "kudos",
    ]);
    expect(sentence(base, "goal")).toBe(
      "Partly met: “Customers can pay with a saved card in the mobile checkout” (Android shipped; iOS waits on the store review)."
    );
    expect(sentence(base, "sayDo")).toBe(
      "26 of 34 committed points done: say/do 76%, close to the commitment."
    );
    expect(sentence(base, "impediments")).toBe(
      "3 impediments raised during the sprint: 2 resolved by its last day, 1 still open, 1 escalated."
    );
    expect(sentence(base, "mood")).toBe(
      "Average mood 3.2 out of 5, from 24 check-ins by 6 people."
    );
    expect(sentence(base, "followThrough")).toBe(
      "2 of 3 actions from the last retro done (67%), 1 carried over."
    );
    expect(lines.find((l) => l.key === "goal")?.href).toBe("/sprint-goal?sprint=s9");
    expect(lines.find((l) => l.key === "sayDo")?.href).toBe("/sprint?sprint=s9");
    expect(lines.find((l) => l.key === "mood")?.href).toBe("/mood-tracker");
    expect(factLines(base, { links: false }).every((l) => !l.href)).toBe(true);
  });

  it("says what's missing instead of showing zeros", () => {
    const empty: RetroFacts = {
      ...base,
      goal: null,
      goalOutcome: null,
      committed: 0,
      completed: 0,
      sayDo: null,
      burndown: null,
      impediments: { raised: 0, resolvedInSprint: 0, stillOpen: 0, escalated: 0 },
      mood: { average: null, checkIns: 0, people: 0 },
      followThrough: null,
      kudos: [],
    };
    expect(sentence(empty, "goal")).toBe("Sprint 9 had no sprint goal.");
    expect(sentence(empty, "sayDo")).toBe("No points were committed to Sprint 9.");
    expect(sentence(empty, "burndown")).toBe(
      "No pointed stories in Sprint 9, so there's no burndown to read."
    );
    expect(sentence(empty, "impediments")).toBe("No impediments were raised during Sprint 9.");
    expect(sentence(empty, "mood")).toBe("No mood check-ins this sprint.");
    expect(sentence(empty, "followThrough")).toBe("No earlier retro to follow up on.");
    expect(sentence(empty, "kudos")).toBe("No kudos were given during Sprint 9.");
    expect(
      factLines(empty)
        .filter((l) => l.missing)
        .map((l) => l.key)
    ).toEqual(["goal", "sayDo", "burndown", "mood", "followThrough", "kudos"]);
  });

  it("holds back an average mood below three check-ins", () => {
    const few = { ...base, mood: { average: null, checkIns: 2, people: 2 } };
    expect(sentence(few, "mood")).toBe(
      "Only 2 mood check-ins this sprint: 1 more before an average means much."
    );
  });

  it("covers an unanswered goal, unrecorded points, typed points and a retro with no actions", () => {
    const f: RetroFacts = {
      ...base,
      goalOutcome: null,
      sayDo: null,
      followThrough: { ...base.followThrough!, agreed: 0, done: 0, carried: 0, rate: null },
    };
    expect(sentence(f, "goal")).toBe(
      "“Customers can pay with a saved card in the mobile checkout”: whether it was met isn't answered yet."
    );
    expect(sentence(f, "sayDo")).toBe("34 points committed; the points done aren't recorded yet.");
    expect(sentence(f, "followThrough")).toBe(
      "The last retro (Start / Stop / Continue · 9 Oct 2026) agreed no actions."
    );
    const typed = { ...base, fromStories: false, sayDo: sayDoRatio(10, 10) };
    expect(sentence({ ...typed, committed: 10, completed: 10 }, "sayDo")).toBe(
      "10 of 10 committed points done (as recorded on the sprint): say/do 100%, met the commitment."
    );
  });

  it("asks for dates instead of reading a sprint without them, its burndown too", () => {
    // A burndown read against no days (or the old 2020 placeholders) says nothing.
    const lines = factLines({ ...base, dated: false });
    expect(lines.map((l) => l.key)).toEqual(["goal", "sayDo", "dates", "followThrough"]);
    expect(lines.find((l) => l.key === "dates")?.sentence).toBe(
      "Sprint 9 has no dates yet, so its burndown and the impediments, mood and kudos from it can't be read."
    );
  });

  it("tells none raised from never logged, and nothing finished from no data", () => {
    const quiet: RetroFacts = {
      ...base,
      impediments: { raised: 0, resolvedInSprint: 0, stillOpen: 0, escalated: 0 },
      burndown: { shape: "none", lateShare: null, sentence: "No pointed story was finished." },
    };
    const line = (key: string, opts?: Parameters<typeof factLines>[1]) =>
      factLines(quiet, opts).find((l) => l.key === key)!;
    expect(line("impediments")).toMatchObject({
      sentence: "No impediments were raised during Sprint 9.",
      missing: false,
    });
    expect(line("impediments", { impedimentsRecorded: false })).toMatchObject({
      sentence: "No impediments recorded in Impediments yet.",
      missing: true,
    });
    // Nothing finished is a finding: shown as one, not muted.
    expect(line("burndown")).toMatchObject({
      sentence: "No pointed story was finished.",
      missing: false,
    });
  });
});

describe("kudos as cards", () => {
  const k = (id: string, toName = "Sam", message = "Thanks") => ({
    id,
    toName,
    fromName: "Priya",
    message,
    sentAt: "2026-10-10T10:00:00Z",
  });

  it("puts each kudos in the column once, with a link back", () => {
    const added = kudosCards([k("k1"), k("k2", "Dev", "Great  demo\n today")], [], "glad");
    expect(added.map((c) => [c.columnKey, c.text, c.sourceRef])).toEqual([
      ["glad", "Kudos to Sam: Thanks", { tool: "kudos", id: "k1" }],
      ["glad", "Kudos to Dev: Great demo today", { tool: "kudos", id: "k2" }],
    ]);
    // Already on the board (added before, or sent from Kudos): skipped.
    expect(
      kudosCards([k("k1"), k("k2")], added.slice(0, 1), "glad").map((c) => c.sourceRef?.id)
    ).toEqual(["k2"]);
    // A kudos listed twice is added once.
    expect(kudosCards([k("k1"), k("k1")], [], "glad")).toHaveLength(1);
  });

  it("makes an example kudos an example card, and keeps long ones within the card limit", () => {
    expect(kudosCards([k("example-kudos-1")], [], "continue")[0].id).toBe("example-retro-kudos-1");
    const long = kudosCardText({ toName: "Sam", message: "x".repeat(2000) });
    expect(long.length).toBe(500);
    expect(long.endsWith("…")).toBe(true);
    expect(kudosCardText({ toName: "  ", message: "" })).toBe("Kudos to the team");
  });
});

describe("the Markdown export", () => {
  const NOW = new Date(2026, 9, 18);
  const cards = [
    card("a", "start", { text: "Flaky tests", votes: 2 }),
    card("b", "start", { text: "Flaky deploys" }),
  ];

  it("adds the sprint, the facts and the common words", () => {
    const md = toMarkdown({ format: startStop, cards }, NOW, {
      sprintName: "Sprint 14",
      facts: factLines(EXAMPLE_FACTS, { links: false }),
      themes: keywordThemes([
        ...cards,
        card("c", "stop", { text: "x" }),
        card("d", "stop", { text: "y" }),
      ]),
    });
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Retro — Sprint 14 — 18 Oct 2026 (Start / Stop / Continue)");
    expect(lines[2]).toBe("## Facts");
    expect(md).toContain(
      "- **Say/do:** 26 of 34 committed points done: say/do 76%, close to the commitment."
    );
    expect(md).toContain("## Common words\n\n- flaky (2 cards): Flaky tests; Flaky deploys\n");
    expect(lines.indexOf("## Common words")).toBeGreaterThan(lines.indexOf("## Action items"));
  });

  it("stays as it was for the board alone (the visitor room's call)", () => {
    expect(toMarkdown({ format: startStop, cards: [] }, NOW)).toBe(
      "# Retro — 18 Oct 2026 (Start / Stop / Continue)\n\nNo cards on the board yet.\n"
    );
    expect(
      toMarkdown({ format: startStop, cards: [] }, NOW, {
        sprintName: "Sprint 1",
        facts: factLines(EXAMPLE_FACTS).slice(0, 1),
      })
    ).toMatch(
      /^# Retro — Sprint 1 — 18 Oct 2026 .*\n\n## Facts\n\n- \*\*Sprint goal:\*\*.*\n\nNo cards on the board yet\.\n$/
    );
  });
});

describe("New Retro's undo", () => {
  it("puts the board back with edits its archive got since, and keeps a new board's cards", () => {
    const before = board("retro:current", {
      cards: [card("a", "start", { isActionItem: true }), card("b", "stop")],
      timerRunning: true,
    });
    const archive = board("retro:x", {
      archivedAt: "2026-10-01",
      cards: [card("a", "start", { isActionItem: true, done: true })],
    });
    const started = board("retro:current", { cards: [card("n", "start", { text: "New" })] });
    const back = boardBeforeNewRetro(before, archive, started);
    expect(back.cards.map((c) => [c.id, c.done ?? false])).toEqual([
      ["a", true],
      ["b", false],
      ["n", false],
    ]);
    expect(back.timerRunning).toBe(false);
    expect(boardBeforeNewRetro(before, undefined, undefined).cards).toEqual(before.cards);
  });

  it("puts a new board's cards in the old format's columns, and folds a carried copy back", () => {
    const k1 = { route: "kanban" as const, targetId: "k1", at: "2026-10-01T10:00:00.000Z" };
    const i9 = { route: "impediment" as const, targetId: "i9", at: "2026-10-02T10:00:00.000Z" };
    const action = card("a", "start", { text: "Pair on tests", isActionItem: true });
    const before = board("retro:current", { cards: [action] });
    const archive = board("retro:x", {
      archivedAt: "2026-10-01",
      cards: [{ ...action, sentTo: [k1] }],
    });
    // Started since in Mad / Sad / Glad: columns Start / Stop / Continue lacks.
    const started = board("retro:current", {
      format: madSadGlad,
      cards: [
        card("g", "glad", { text: "Nice demo" }),
        card("g2", "glad", { text: "Same here", groupedWith: "g" }),
        card("copy", "mad", {
          text: "Pair on tests",
          isActionItem: true,
          carriedFrom: "a",
          assignee: "Sam",
          done: true,
          doneAt: "2026-10-02T10:00:00.000Z",
          sentTo: [k1, i9],
        }),
        card("under", "mad", { text: "Under the copy", groupedWith: "copy" }),
      ],
    });
    const back = boardBeforeNewRetro(before, archive, started);
    expect(back.format.id).toBe(startStop.id);
    expect(back.cards.map((c) => [c.id, c.columnKey, c.groupedWith])).toEqual([
      ["a", "start", null],
      ["g", "start", null],
      ["g2", "start", "g"],
      ["under", "start", null],
    ]);
    // The original is back with what its copy got since; the copy is gone.
    expect(back.cards[0]).toMatchObject({
      assignee: "Sam",
      done: true,
      doneAt: "2026-10-02T10:00:00.000Z",
      sentTo: [k1, i9],
    });
    const keys = new Set(startStop.columns.map((c) => c.key));
    expect(back.cards.every((c) => keys.has(c.columnKey))).toBe(true);
  });
});

describe("a new card's text", () => {
  it("must be written, and fit the limit", () => {
    expect(validateCardText({ text: "  " })).toEqual({
      ok: false,
      errors: { text: "Write the card first." },
    });
    expect(validateCardText({ text: " Pair more " })).toEqual({ ok: true, values: "Pair more" });
    expect(validateCardText({ text: "abcdef" }, 5)).toEqual({
      ok: false,
      errors: { text: "Keep it to 5 characters." },
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the sprint a retro looks back on", () => {
  it("offers a first-run empty state with the example", () => {
    useWorkspaceStore.setState({ sprints: [] });
    renderPage();
    expect(screen.getByText(/No retro yet\. Pick a format below/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(
      screen.getByText(/No sprints yet, so this retro isn't linked to one/)
    ).toBeInTheDocument();
  });

  it("starts a board on the sprint whose retro window holds today, shown first", () => {
    seedBoards(lastRetro());
    renderPage();
    expect(screen.getByRole("combobox", { name: "Retro for" })).toHaveTextContent("Sprint 12");
    fireEvent.click(screen.getByRole("button", { name: madSadGlad.name }));
    expect(current()).toMatchObject({
      sprintId: "s1",
      format: { id: "mad-sad-glad" },
      previousRetroId: lastRetro().id,
    });
    expect(logged(RETRO_ACTIONS.FORMAT_CHANGED)[0][1]).toEqual({
      format: madSadGlad.name,
      sprintId: "s1",
    });
  });

  it("starts on the sprint a ?sprint= link names", async () => {
    window.history.replaceState(null, "", "/retro?sprint=s2");
    renderPage();
    expect(await screen.findByRole("combobox", { name: "Retro for" })).toHaveTextContent(
      "Sprint 13"
    );
    fireEvent.click(screen.getByRole("button", { name: startStop.name }));
    expect(current()?.sprintId).toBe("s2");
  });

  it("can start unlinked, or on another sprint", () => {
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(screen.getByText("Not linked to a sprint.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: startStop.name }));
    expect(current()).toBeDefined();
    expect("sprintId" in current()!).toBe(false);
    unmount();

    seedBoards();
    renderPage();
    chooseSprint("Sprint 13");
    fireEvent.click(screen.getByRole("button", { name: startStop.name }));
    expect(current()?.sprintId).toBe("s2");
  });

  it("links a board to a sprint only when someone picks one, and logs it", async () => {
    // A board from before retros were per sprint.
    seedBoards(board("retro:current", { cards: [card("a", "start", { text: "Legacy card" })] }));
    renderPage();
    expect(screen.getByText("Legacy card")).toBeInTheDocument();
    expect(screen.getByText("Not linked to a sprint.")).toBeInTheDocument();
    expect(current()?.sprintId).toBeUndefined();
    expect(screen.queryByRole("group", { name: /Facts from/ })).toBeNull();
    expect(screen.getByText("1 card in 1 column.")).toBeInTheDocument();

    chooseSprint("Sprint 12");
    expect(current()?.sprintId).toBe("s1");
    expect(logged(RETRO_ACTIONS.SPRINT_SET)[0][1]).toEqual({
      sprintId: "s1",
      sprintName: "Sprint 12",
    });
    await waitFor(() =>
      expect(announced()).toHaveTextContent("This retro looks back on Sprint 12.")
    );
    expect(screen.getByRole("group", { name: "Facts from Sprint 12" })).toBeInTheDocument();
    expect(
      screen.getByText("1 card in 1 column; Sprint 12 didn't meet its goal.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(current()).toBeDefined();
    expect("sprintId" in current()!).toBe(false);
    expect(logged(RETRO_ACTIONS.SPRINT_SET)[1][1]).toEqual({ sprintId: null });
    expect(screen.queryByRole("group", { name: /Facts from/ })).toBeNull();
  });

  it("says when the board's sprint was deleted", () => {
    seedBoards(board("retro:current", { sprintId: "gone", cards: [card("a", "start")] }));
    renderPage();
    expect(screen.getByText(/Its sprint was deleted/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Facts from/ })).toBeNull();
  });

  it("keeps the sprint on the archived copy and names it under Past retros", () => {
    seedBoards(board("retro:current", { sprintId: "s1", cards: [card("a", "start")] }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start new retro" }));
    expect(archives()[0].sprintId).toBe("s1");
    const past = screen.getByRole("region", { name: "Past retros" });
    expect(within(past).getByText(/· Sprint 12 · Start \/ Stop \/ Continue/)).toBeInTheDocument();
  });
});

describe("the facts panel", () => {
  it("opens the Write phase with the sprint's facts, each linked to its tool", () => {
    seedBoards(lastRetro(), board("retro:current", { sprintId: "s1" }));
    renderPage();
    const facts = screen.getByRole("group", { name: "Facts from Sprint 12" });
    expect(facts).toHaveAttribute("open");
    const text = facts.textContent ?? "";
    expect(text).toContain("Not met: “Ship saved cards”.");
    // Sprint 12 is closed: its say/do is the one recorded on it.
    expect(text).toContain(
      "5 of 20 committed points done (as recorded on the sprint): say/do 25%, missed the commitment."
    );
    expect(text).toContain("Most of the done points (100%) landed in the sprint's last third.");
    expect(text).toContain(
      "2 impediments raised during the sprint: 1 resolved by its last day, 1 still open."
    );
    expect(text).toContain(
      "Only 2 mood check-ins this sprint: 1 more before an average means much."
    );
    expect(text).toContain("1 of 2 actions from the last retro done (50%), 1 still open.");
    expect(text).toContain("2 kudos given during the sprint");
    expect(within(facts).getByRole("link", { name: /Sprint Goal/ })).toHaveAttribute(
      "href",
      "/sprint-goal?sprint=s1"
    );
    expect(within(facts).getByRole("link", { name: /Mood Tracker/ })).toHaveAttribute(
      "href",
      "/mood-tracker"
    );
    // The export carries the sprint and the facts.
    expect(exported.markdown).toMatch(/^# Retro — Sprint 12 — /);
    expect(exported.markdown).toContain("- **Mood:** Only 2 mood check-ins this sprint");
  });

  it("says a fact has no data rather than showing zeros", () => {
    seedBoards(board("retro:current", { sprintId: "s2" }));
    renderPage();
    const text = screen.getByRole("group", { name: "Facts from Sprint 13" }).textContent ?? "";
    expect(text).toContain("Sprint 13 had no sprint goal.");
    expect(text).toContain("No points were committed to Sprint 13.");
    expect(text).toContain("No mood check-ins this sprint.");
    expect(text).toContain("No impediments were raised during Sprint 13.");
    expect(text).toContain("No kudos were given during Sprint 13.");
    expect(text).not.toMatch(/\b0 (impediments|check-ins|kudos)\b/);
  });

  it("folds away after the Write phase", () => {
    seedBoards(
      board("retro:current", { sprintId: "s1", phase: "vote", cards: [card("a", "start")] })
    );
    renderPage();
    expect(screen.getByRole("group", { name: "Facts from Sprint 12" })).not.toHaveAttribute("open");
  });

  it("shows the example's own facts on the example board, with no links out", () => {
    seedBoards(lastRetro());
    useWorkspaceStore.setState({ retroBoards: [] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const facts = screen.getByRole("group", { name: "Facts from Sprint 14" });
    expect(facts).toHaveTextContent("The example sprint's");
    expect(within(facts).queryAllByRole("link")).toHaveLength(0);
    // Never the user's real sprint.
    expect(screen.queryByText(/Ship saved cards/)).toBeNull();
    expect(current()?.sprintId).toBeUndefined();
    // Example actions can't reach the real Impediments or Kanban.
    expect(screen.getAllByText("Example card: not sent to other tools")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Send to…/ })).toBeNull();
  });
});

describe("kudos as appreciation cards", () => {
  it("adds the sprint's kudos to the appreciations column once, with Undo", () => {
    seedBoards(board("retro:current", { sprintId: "s1" }));
    renderPage();
    const panel = screen.getByRole("region", { name: "Kudos from Sprint 12" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2); // k3 is from before the sprint
    fireEvent.click(
      within(panel).getByRole("button", { name: "Add 2 kudos as cards in Continue" })
    );

    const added = current()!.cards;
    expect(added.map((c) => [c.columnKey, c.text, c.sourceRef])).toEqual([
      ["continue", "Kudos to Sam: Fixed the flaky tests", { tool: "kudos", id: "k1" }],
      ["continue", "Kudos to Dev: Great demo", { tool: "kudos", id: "k2" }],
    ]);
    expect(logged(RETRO_ACTIONS.KUDOS_ADDED)[0][1]).toMatchObject({
      count: 2,
      columnKey: "continue",
    });
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Added 2 kudos as cards");
    expect(screen.getAllByRole("link", { name: "From kudos" })).toHaveLength(2);
    expect(
      within(panel).getByText("Every kudos is on the board, in Continue.")
    ).toBeInTheDocument();
    expect(within(panel).getAllByText("On the board")).toHaveLength(2);

    act(() => lastUndo()());
    expect(current()!.cards).toEqual([]);
    expect(
      within(panel).getByRole("button", { name: "Add 2 kudos as cards in Continue" })
    ).toBeInTheDocument();
  });

  it("skips a kudos already on the board and picks the format's appreciations column", () => {
    seedBoards(
      board("retro:current", {
        sprintId: "s1",
        format: madSadGlad,
        cards: [
          card("x", "glad", { text: "Sent from Kudos", sourceRef: { tool: "kudos", id: "k1" } }),
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 kudos as a card in Glad" }));
    expect(current()!.cards.map((c) => c.sourceRef?.id)).toEqual(["k1", "k2"]);
    expect(current()!.cards[1].columnKey).toBe("glad");
  });
});

describe("common words on the board", () => {
  const texts = [
    "Flaky UI tests",
    "The flaky deploy job",
    "Tests are flaky on CI",
    "Deploys take an hour",
    "Long standups",
    "Pairing on reviews",
    "Code reviews were slow",
    "Docs are out of date",
    "Demo went well",
  ];

  it("waits for ten cards, then rings a word's cards and gives the AI the groups", async () => {
    const cards = texts.map((t, i) => card(`c${i}`, i % 2 ? "stop" : "start", { text: t }));
    seedBoards(board("retro:current", { cards }));
    renderPage();
    expect(screen.queryByRole("region", { name: "Common words" })).toBeNull();
    expect(ai.prompts[0].prompt).not.toContain("Common words on the board");

    act(() => {
      const b = current()!;
      ws().upsertRetroBoard({
        ...b,
        cards: [...b.cards, card("c9", "continue", { text: "Onboarding guide" })],
      });
    });
    const panel = screen.getByRole("region", { name: "Common words" });
    const chip = within(panel).getByRole("button", { name: "flaky · 3 cards" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(3);
    // Each ringed card says so to a screen reader moving through the columns.
    expect(screen.getAllByText("Ringed for “flaky”.")).toHaveLength(3);
    await waitFor(() => expect(announced()).toHaveTextContent("Ringed 3 cards with “flaky”."));
    fireEvent.click(chip);
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
    expect(screen.queryByText("Ringed for “flaky”.")).toBeNull();

    expect(ai.prompts[0].prompt).toContain("Common words on the board");
    expect(ai.prompts[0].prompt).toContain('"flaky"');
    expect(exported.markdown).toContain("## Common words");
  });
});

describe("action owners", () => {
  const actionBoard = () =>
    board("retro:current", {
      phase: "actions",
      cards: [card("a", "start", { text: "Pair on tests", isActionItem: true })],
    });

  it("saves the owner once, when the field is left, and logs it", () => {
    seedBoards(actionBoard());
    renderPage();
    // A roster-backed input (with a <datalist>) is a combobox.
    const input = screen.getByRole("combobox", { name: "Owner of “Pair on tests”" });
    act(() => input.focus());
    for (const v of ["S", "Sa", "Sam"]) fireEvent.change(input, { target: { value: v } });
    expect(current()!.cards[0].assignee).toBe("");
    expect(input).toHaveValue("Sam");

    fireEvent.blur(input);
    expect(current()!.cards[0].assignee).toBe("Sam");
    expect(logged(RETRO_ACTIONS.ACTION_ASSIGNED)).toEqual([
      [RETRO_ACTIONS.ACTION_ASSIGNED, { cardId: "a", assignee: "Sam" }],
    ]);
    expect(screen.getByText("1 action agreed, each with an owner.")).toBeInTheDocument();
  });

  it("saves on Enter, puts the saved name back on Escape, and offers the roster", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Priya" }] });
    seedBoards(actionBoard());
    renderPage();
    const input = () => screen.getByRole("combobox", { name: "Owner of “Pair on tests”" });
    act(() => input().focus());
    fireEvent.change(input(), { target: { value: " Priya " } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(current()!.cards[0].assignee).toBe("Priya");

    act(() => input().focus());
    fireEvent.change(input(), { target: { value: "Zed" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveValue("Priya");
    fireEvent.blur(input());
    expect(current()!.cards[0].assignee).toBe("Priya");
    expect(logged(RETRO_ACTIONS.ACTION_ASSIGNED)).toHaveLength(1);
    expect(document.querySelector(`datalist option[value="Priya"]`)).not.toBeNull();
  });
});

describe("action owners, from outside the roster", () => {
  it("saves at once when the picker's “Add to the team” is clicked", () => {
    seedBoards(
      board("retro:current", {
        phase: "actions",
        cards: [card("a", "start", { text: "Pair on tests", isActionItem: true })],
      })
    );
    renderPage();
    const input = screen.getByRole("combobox", { name: "Owner of “Pair on tests”" });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Newbie" } });
    expect(current()!.cards[0].assignee).toBe("");
    const add = screen.getByRole("button", { name: "Add to the team" });
    // Moving to the button is still inside the field: nothing saved yet.
    act(() => add.focus());
    expect(current()!.cards[0].assignee).toBe("");
    fireEvent.click(add);
    expect(current()!.cards[0].assignee).toBe("Newbie");
    expect(ws().teamMembers.map((m) => m.name)).toEqual(["Newbie"]);
    expect(logged(RETRO_ACTIONS.ACTION_ASSIGNED)).toHaveLength(1);
  });
});

describe("the example", () => {
  it("adds its own kudos as example cards, which Clear example takes away", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: /Previous phase/ }));
    const panel = screen.getByRole("region", { name: "Kudos from Sprint 14" });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Add 2 kudos as cards in Continue" })
    );
    const kudosCards = current()!.cards.filter((c) => c.sourceRef?.tool === "kudos");
    expect(kudosCards.map((c) => c.id)).toEqual(["example-retro-kudos-1", "example-retro-kudos-2"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(current()).toBeUndefined();
    // Exploring the example isn't the team's work.
    expect(logged(RETRO_ACTIONS.KUDOS_ADDED)).toHaveLength(0);
  });
});

describe("adding a card", () => {
  it("says what's missing instead of ignoring an empty Enter", () => {
    seedBoards(board("retro:current", { cards: [] }));
    renderPage();
    const input = screen.getByRole("textbox", { name: "New card for Start" });
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Write the card first.");
    expect(current()!.cards).toEqual([]);
    expect(screen.getByRole("button", { name: "Add card to Start" })).not.toBeDisabled();

    fireEvent.change(input, { target: { value: "Pair more" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add card to Start" }));
    expect(current()!.cards.map((c) => c.text)).toEqual(["Pair more"]);
    expect(input).toHaveValue("");
  });
});

describe("New Retro", () => {
  it("can be undone: the board comes back and its archive goes", () => {
    seedBoards(
      board("retro:current", { sprintId: "s1", cards: [card("a", "start", { text: "Keep me" })] })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start new retro" }));
    expect(current()).toBeUndefined();
    expect(archives()).toHaveLength(1);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Started a new retro");

    act(() => lastUndo()());
    expect(current()?.cards.map((c) => c.text)).toEqual(["Keep me"]);
    expect(current()?.sprintId).toBe("s1");
    expect(archives()).toHaveLength(0);
    expect(screen.getByText("Keep me")).toBeInTheDocument();
  });

  it("names the past retro that drops off at the limit, and Undo brings it back", () => {
    const old = Array.from({ length: RETRO_ARCHIVE_LIMIT }, (_, i) => {
      const at = `2026-0${1 + Math.floor(i / 10)}-${String(10 + (i % 10)).padStart(2, "0")}T10:00:00.000Z`;
      return board(`retro:${at}`, { archivedAt: at, cards: [card(`o${i}`, "start")] });
    });
    const oldest = old[0];
    seedBoards(...old, board("retro:current", { cards: [card("a", "start")] }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    const dialog = screen.getByRole("dialog", { name: "Start a new retro?" });
    const day = new Date(oldest.archivedAt!).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    expect(dialog).toHaveTextContent(
      `Past retros keep the latest ${RETRO_ARCHIVE_LIMIT}, so the ${day} Start / Stop / Continue retro will drop off (Undo brings it back).`
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Start new retro" }));
    expect(archives()).toHaveLength(RETRO_ARCHIVE_LIMIT);
    expect(archives().some((b) => b.id === oldest.id)).toBe(false);
    expect(toastSpy.mock.calls.at(-1)?.[1].description).toContain(
      "the oldest past retro dropped off"
    );

    act(() => lastUndo()());
    expect(archives().some((b) => b.id === oldest.id)).toBe(true);
    expect(archives()).toHaveLength(RETRO_ARCHIVE_LIMIT);
    expect(current()?.cards.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("the rest of the board", () => {
  it("links a card another tool sent back to it", () => {
    seedBoards(
      board("retro:current", {
        cards: [
          card("h", "stop", {
            text: "Health check: speed is red",
            sourceRef: { tool: "health-check", id: "hc1" },
          }),
        ],
      })
    );
    renderPage();
    expect(screen.getByRole("link", { name: "From health check" })).toHaveAttribute(
      "href",
      "/health-check"
    );
  });

  it("names the timer presets as pressed buttons and says where the board is saved", () => {
    seedBoards(board("retro:current", { cards: [card("a", "start")] }));
    renderPage();
    // Named in words ("5 minutes"), not "5m", which reads as "5 meters".
    const five = screen.getByRole("button", { name: "5 minutes" });
    expect(five).toHaveTextContent("5m");
    expect(five).toHaveAttribute("type", "button");
    expect(five).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "10 minutes" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "10 minutes" }));
    expect(current()?.timerSeconds).toBe(600);
    expect(screen.getByText(/Saved in your workspace/)).toBeInTheDocument();
    expect(screen.queryByText(/Local session/)).toBeNull();
  });

  it("announces the timer starting and running out", () => {
    vi.useFakeTimers();
    try {
      seedBoards(board("retro:current", { cards: [card("a", "start")], timerSeconds: 1 }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(announced()).toHaveTextContent("Timer started: 0:01.");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(current()).toMatchObject({ timerSeconds: 0, timerRunning: false });
      expect(screen.getByTestId("live-assertive")).toHaveTextContent("Time's up.");
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── After review ───────────────────────────────────────────────────── */

describe("say/do once the sprint is closed", () => {
  it("reads the numbers recorded on the sprint, not the done stories left in it", () => {
    useWorkspaceStore.setState({
      sprints: [{ ...S1, status: "active", pointsPlanned: 8, pointsCompleted: undefined }, S2],
    });
    // Closing carries the unfinished story (3 points) over into Sprint 13.
    const closed = closeSprint("s1", 5, { target: "next", stories: [stories[1]], nextSprint: S2 });
    expect(closed?.moved).toBe(1);
    expect(ws().stories.find((s) => s.id === "st2")?.sprintId).toBe("s2");

    seedBoards(board("retro:current", { sprintId: "s1" }));
    renderPage();
    const text = screen.getByRole("group", { name: "Facts from Sprint 12" }).textContent ?? "";
    expect(text).toContain(
      "5 of 8 committed points done (as recorded on the sprint): say/do 63%, missed the commitment."
    );
    expect(text).not.toContain("say/do 100%");
  });

  it("keeps the stories' numbers for an open sprint, or a closed one with nothing recorded", () => {
    const f = EXAMPLE_FACTS;
    expect(withClosedSprintSayDo(f, S2)).toBe(f);
    expect(withClosedSprintSayDo(f, { ...S1, pointsPlanned: 0 })).toBe(f);
    expect(withClosedSprintSayDo(f, { ...S1, pointsCompleted: undefined })).toBe(f);
    expect(withClosedSprintSayDo(f, S1)).toMatchObject({
      committed: 20,
      completed: 5,
      fromStories: false,
      sayDo: sayDoRatio(20, 5),
    });
  });
});

describe("the sprint a new board defaults to", () => {
  it("skips a sprint whose retro is already under Past retros", () => {
    const at = `${day(-1)}T10:00:00.000Z`;
    seedBoards(
      board(`retro:${at}`, { archivedAt: at, sprintId: "s1", cards: [card("z", "start")] })
    );
    renderPage();
    expect(screen.getByRole("combobox", { name: "Retro for" })).toHaveTextContent("Sprint 13");
    fireEvent.click(screen.getByRole("button", { name: startStop.name }));
    expect(current()?.sprintId).toBe("s2");
  });

  it("skips one archived before retros named their sprint, placed by its day", () => {
    const at = `${day(-1)}T10:00:00.000Z`;
    seedBoards(board(`retro:${at}`, { archivedAt: at, cards: [card("z", "start")] }));
    renderPage();
    expect(screen.getByRole("combobox", { name: "Retro for" })).toHaveTextContent("Sprint 13");
  });

  it("applies a ?sprint= link to the first board only", async () => {
    window.history.replaceState(null, "", "/retro?sprint=s2");
    renderPage();
    expect(await screen.findByRole("combobox", { name: "Retro for" })).toHaveTextContent(
      "Sprint 13"
    );
    fireEvent.click(screen.getByRole("button", { name: startStop.name }));
    expect(current()?.sprintId).toBe("s2");
    // An empty board's New Retro needs no confirmation.
    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));
    expect(current()).toBeUndefined();
    expect(screen.getByRole("combobox", { name: "Retro for" })).toHaveTextContent("Sprint 12");
  });
});

describe("the example and real sprints", () => {
  it("can't be linked to a real sprint, and shows its own facts even when it names one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.queryByRole("combobox", { name: "Retro for" })).toBeNull();
    expect(
      screen.getByText(/Clear the example to link this retro to one of your sprints/)
    ).toBeInTheDocument();
    // An agent's set_sprint on the example board.
    act(() => ws().upsertRetroBoard({ ...current()!, sprintId: "s1" }));
    expect(screen.getByRole("group", { name: "Facts from Sprint 14" })).toBeInTheDocument();
    expect(screen.queryByText(/Ship saved cards/)).toBeNull();

    // Cleared, with a card of the team's left: the picker is back.
    act(() =>
      ws().upsertRetroBoard({
        ...current()!,
        cards: [...current()!.cards, card("mine", "start", { text: "Mine" })],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("combobox", { name: "Retro for" })).toHaveTextContent("Sprint 12");
    expect(screen.getByRole("group", { name: "Facts from Sprint 12" })).toBeInTheDocument();
  });

  it("lists no real retro's actions on the example", () => {
    seedBoards(lastRetro(), { id: "retro:current", ...buildExample(), phase: "write" });
    renderPage();
    expect(screen.queryByRole("region", { name: "Actions from the last retro" })).toBeNull();
    expect(screen.getByRole("group", { name: "Facts from Sprint 14" })).toHaveTextContent(
      "2 of 3 actions from the last retro done (67%), 1 carried over."
    );
  });
});

describe("the last retro, in the facts and in the panel", () => {
  // Sprint 12's own first retro, archived yesterday, after the one before it.
  const own = () => {
    const at = `${day(-1)}T09:00:00.000Z`;
    return board(`retro:${at}`, {
      archivedAt: at,
      sprintId: "s1",
      phase: "actions",
      cards: [card("o1", "start", { text: "Own action", isActionItem: true })],
    });
  };
  const facts = () => screen.getByRole("group", { name: "Facts from Sprint 12" });
  const panel = () => screen.getByRole("region", { name: "Actions from the last retro" });

  it("is the one the facts pick for the sprint when the board names none", () => {
    seedBoards(lastRetro(), own(), board("retro:current", { sprintId: "s1" }));
    renderPage();
    expect(within(panel()).getByText("Stop late merges")).toBeInTheDocument();
    expect(within(panel()).queryByText("Own action")).toBeNull();
    expect(facts()).toHaveTextContent(
      "1 of 2 actions from the last retro done (50%), 1 still open."
    );
  });

  it("is the one the board was started after, in both", () => {
    seedBoards(
      lastRetro(),
      own(),
      board("retro:current", { sprintId: "s1", previousRetroId: own().id })
    );
    renderPage();
    expect(within(panel()).getByText("Own action")).toBeInTheDocument();
    expect(within(panel()).queryByText("Stop late merges")).toBeNull();
    expect(facts()).toHaveTextContent("0 of 1 action from the last retro done (0%), 1 still open.");
  });

  it("offers no Carry over for an action that got done", () => {
    seedBoards(lastRetro(), board("retro:current", { previousRetroId: lastRetro().id }));
    renderPage();
    const [done, open] = within(panel()).getAllByRole("listitem");
    expect(done).toHaveTextContent("Pair on reviews");
    expect(within(done).getByText("Done")).toBeInTheDocument();
    expect(within(done).queryByRole("button", { name: /^Carry over/ })).toBeNull();
    expect(
      within(open).getByRole("button", { name: "Carry over Stop late merges" })
    ).toBeInTheDocument();
  });
});

describe("keyboard focus", () => {
  it("stays on the sprint picker after a pick and after Unlink", () => {
    seedBoards(board("retro:current", { cards: [card("a", "start")] }));
    renderPage();
    const trigger = screen.getByRole("combobox", { name: "Retro for" });
    chooseSprint("Sprint 12");
    // The same select, not a new one: focus isn't dropped to the page.
    expect(screen.getByRole("combobox", { name: "Retro for" })).toBe(trigger);
    expect(trigger).toHaveTextContent("Sprint 12");

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(screen.getByRole("combobox", { name: "Retro for" })).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("Choose a sprint");
    expect(current()?.sprintId).toBeUndefined();
  });

  it("moves to the line that says every kudos is on the board", () => {
    seedBoards(board("retro:current", { sprintId: "s1" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 kudos as cards in Continue" }));
    expect(document.activeElement).toHaveTextContent("Every kudos is on the board, in Continue.");
  });
});

describe("Undo of the kudos cards", () => {
  it("keeps a card grouped under one of them since, on its own", () => {
    seedBoards(board("retro:current", { sprintId: "s1" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 kudos as cards in Continue" }));
    const undo = lastUndo();
    const kudosCard = current()!.cards[0];
    act(() =>
      ws().upsertRetroBoard({
        ...current()!,
        cards: [
          ...current()!.cards,
          card("mine", "continue", { text: "Me too", groupedWith: kudosCard.id }),
        ],
      })
    );
    act(() => undo());
    expect(current()!.cards).toEqual([expect.objectContaining({ id: "mine", groupedWith: null })]);
    expect(screen.getByText("Me too")).toBeInTheDocument();
  });
});

describe("common words below the bar", () => {
  it("says how many more cards they need, from the first card", () => {
    seedBoards(board("retro:current"));
    const { unmount } = renderPage();
    expect(screen.queryByText(/to see the words they share/)).toBeNull();
    unmount();

    seedBoards(
      board("retro:current", {
        cards: [
          card("a", "start", { text: "One" }),
          card("b", "stop", { text: "Two" }),
          card("c", "stop", { text: "Three", groupedWith: "b" }),
        ],
      })
    );
    renderPage();
    // A group counts once: two of ten.
    expect(screen.getByText("Add 8 more cards to see the words they share.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Common words" })).toBeNull();
  });
});

describe("adding a voter by hand", () => {
  it("says what's missing instead of ignoring an empty name", () => {
    seedBoards(board("retro:current", { phase: "vote", cards: [card("a", "start")] }));
    renderPage();
    const add = screen.getByRole("button", { name: "Add voter" });
    expect(add).not.toBeDisabled();
    fireEvent.click(add);
    expect(screen.getByRole("alert")).toHaveTextContent("Type a name first.");
    expect(current()!.votesBy).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Add a voter"), { target: { value: " Alex " } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(add);
    expect(current()!.votesBy).toEqual({ Alex: 0 });
    expect(screen.getByLabelText("Add a voter")).toHaveValue("");
  });
});
