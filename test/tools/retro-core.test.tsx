import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro: the pure helpers no other suite reaches — timer and grid
 * formatting, vote sorting, per-person vote budgets, the theme-clustering
 * features, the JSON export, picking the previous retro and carrying its
 * actions over, clearing the example, the Markdown export's grouping, and
 * the live room's message readers and countdown. Plus the board's "Group
 * with" picker, which must keep groups one level deep.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => false,
  getSupabaseClient: () => null,
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

import {
  buildExportJson,
  columnGridClass,
  extractCardFeatures,
  formatTimer,
  makeId,
  sortedByVotes,
  voterKey,
  voterNames,
  votesCastBy,
  withoutVotesBy,
} from "@/app/(tools)/retro/helpers";
import { carriedOverCard, previousRetro } from "@/app/(tools)/retro/archive";
import { buildExample, withoutExampleCards } from "@/app/(tools)/retro/example";
import { toMarkdown } from "@/app/(tools)/retro/markdown";
import { readEndMessage, readIntentEnv, readKickMessage } from "@/app/(tools)/retro/room/protocol";
import { createIntentLedger } from "@/app/(tools)/retro/room/intents";
import { timerRemaining } from "@/app/(tools)/retro/room/use-retro-room";
import { Board } from "@/app/(tools)/retro/components/board";

const NOW = new Date(2026, 9, 18);
const format = retroFormats[0]; // Start / Stop / Continue

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

function archived(id: string, archivedAt: string | undefined, cards: RetroCard[] = []): RetroBoard {
  return {
    id,
    format,
    phase: "actions",
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...(archivedAt ? { archivedAt } : {}),
  };
}

describe("formatTimer", () => {
  it("shows minutes and zero-padded seconds", () => {
    expect(formatTimer(0)).toBe("0:00");
    expect(formatTimer(5)).toBe("0:05");
    expect(formatTimer(59)).toBe("0:59");
    expect(formatTimer(60)).toBe("1:00");
    expect(formatTimer(300)).toBe("5:00");
    expect(formatTimer(3599)).toBe("59:59");
    expect(formatTimer(3600)).toBe("60:00");
  });
});

describe("columnGridClass", () => {
  it("fits the grid to the column count", () => {
    expect(columnGridClass(1)).toBe("grid-cols-1 sm:grid-cols-2");
    expect(columnGridClass(2)).toBe("grid-cols-1 sm:grid-cols-2");
    expect(columnGridClass(3)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-3");
    expect(columnGridClass(4)).toBe("grid-cols-1 sm:grid-cols-2 xl:grid-cols-4");
    expect(columnGridClass(5)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5");
    expect(columnGridClass(6)).toBe(columnGridClass(5));
  });
});

describe("makeId", () => {
  it("makes distinct ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeId()));
    expect(ids.size).toBe(50);
  });
});

describe("sortedByVotes", () => {
  it("sorts most-voted first, keeps ties in board order and leaves the input alone", () => {
    const cards = [card("a", "start"), card("b", "start", { votes: 3 }), card("c", "start")];
    expect(sortedByVotes(cards).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(sortedByVotes([])).toEqual([]);
  });
});

describe("per-person votes", () => {
  it("matches a voter's key ignoring case and spaces, else uses the trimmed name", () => {
    const votesBy = { Priya: 2, sam: 1 };
    expect(voterKey(votesBy, "  PRIYA ")).toBe("Priya");
    expect(voterKey(votesBy, "Sam")).toBe("sam");
    expect(voterKey(votesBy, " Lee ")).toBe("Lee");
    expect(voterKey(undefined, " Lee ")).toBe("Lee");
  });

  it("counts a voter's votes, treating junk counts as none", () => {
    const votesBy = { Priya: 2, Neg: -1, Bad: Number.NaN, Inf: Infinity };
    expect(votesCastBy(votesBy, "priya")).toBe(2);
    expect(votesCastBy(votesBy, "Neg")).toBe(0);
    expect(votesCastBy(votesBy, "Bad")).toBe(0);
    expect(votesCastBy(votesBy, "Inf")).toBe(0);
    expect(votesCastBy(votesBy, "Nobody")).toBe(0);
    expect(votesCastBy(undefined, "Priya")).toBe(0);
  });

  it("lists the roster first, then hand-added voters, once each", () => {
    expect(voterNames(["Priya", " priya ", "", "  ", "Sam"], { PRIYA: 2, Lee: 0, sam: 1 })).toEqual(
      ["Priya", "Sam", "Lee"]
    );
    expect(voterNames([])).toEqual([]);
  });

  it("drops every person's votes without touching the board it was given", () => {
    const board = { ...buildExample(), votesBy: { Priya: 1 } };
    const cleared = withoutVotesBy(board);
    expect(cleared).not.toHaveProperty("votesBy");
    expect(board.votesBy).toEqual({ Priya: 1 });
    expect(cleared.cards).toBe(board.cards);
  });
});

describe("extractCardFeatures", () => {
  it("measures length, words, exclamations and questions", () => {
    expect(extractCardFeatures("Why did it break?!")).toEqual([0.18, 4 / 20, 1 / 5, 1 / 5]);
  });

  it("is all zeros for empty or blank text", () => {
    expect(extractCardFeatures("")).toEqual([0, 0, 0, 0]);
    expect(extractCardFeatures("   ")).toEqual([0.03, 0, 0, 0]);
  });

  it("caps the exclamation and question features at 1", () => {
    const f = extractCardFeatures("!!!!!!!!!! ??????????");
    expect(f[2]).toBe(1);
    expect(f[3]).toBe(1);
  });
});

describe("buildExportJson", () => {
  afterEach(() => vi.useRealTimers());

  it("groups cards by the format's columns and leaves out empty owners", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T09:30:00.000Z"));
    const json = buildExportJson({
      format,
      cards: [
        card("a", "start", { text: "Pair more", votes: 2, isActionItem: true, assignee: "Sam" }),
        card("b", "stop", { text: "Late merges", votes: 1 }),
        card("x", "not-a-column", { text: "Lost" }),
      ],
    });
    expect(json).toEqual({
      format: "Start / Stop / Continue",
      date: "2026-10-18T09:30:00.000Z",
      columns: [
        {
          label: "Start",
          cards: [{ text: "Pair more", votes: 2, isActionItem: true, assignee: "Sam" }],
        },
        {
          label: "Stop",
          cards: [{ text: "Late merges", votes: 1, isActionItem: false, assignee: undefined }],
        },
        { label: "Continue", cards: [] },
      ],
    });
  });
});

describe("previousRetro", () => {
  const older = archived("retro:2026-09-01", "2026-09-01T10:00:00.000Z");
  const newer = archived("retro:2026-10-01", "2026-10-01T10:00:00.000Z");
  const current = archived("retro:current", undefined);

  it("picks the archive the board names", () => {
    expect(previousRetro([current, newer, older], older.id)).toBe(older);
  });

  it("falls back to the newest archive for a missing or non-archived id", () => {
    expect(previousRetro([older, current, newer])).toBe(newer);
    expect(previousRetro([older, newer], "retro:gone")).toBe(newer);
    expect(previousRetro([older, newer, current], current.id)).toBe(newer);
  });

  it("is null when nothing has been archived", () => {
    expect(previousRetro([])).toBeNull();
    expect(previousRetro([current], current.id)).toBeNull();
  });
});

describe("carriedOverCard", () => {
  const action = card("old-1", "stop", {
    text: "Fix flaky tests",
    votes: 4,
    isActionItem: true,
    assignee: "Sam",
    discussing: true,
    groupedWith: "old-0",
    done: true,
    doneAt: "2026-10-01T00:00:00.000Z",
    sentTo: [{ route: "kanban", targetId: "k1", at: "2026-10-01T00:00:00.000Z" }],
  });

  it("is a fresh, unvoted action in the same column, remembering where it came from", () => {
    expect(carriedOverCard(action, ["start", "stop", "continue"], "new-1")).toEqual({
      id: "new-1",
      columnKey: "stop",
      text: "Fix flaky tests",
      votes: 0,
      groupedWith: null,
      isActionItem: true,
      assignee: "Sam",
      discussing: false,
      sentTo: action.sentTo,
      carriedFrom: "old-1",
    });
  });

  it("lands in the first column when this format doesn't have the old one", () => {
    expect(carriedOverCard(action, ["mad", "sad", "glad"], "n").columnKey).toBe("mad");
    expect(carriedOverCard(action, [], "n").columnKey).toBe("stop");
  });

  it("leaves out an empty hand-off list", () => {
    const c = carriedOverCard({ ...action, sentTo: [] }, ["stop"], "n");
    expect(c).not.toHaveProperty("sentTo");
    expect(c).not.toHaveProperty("done");
  });
});

describe("withoutExampleCards", () => {
  it("removes the example's cards and unhooks the user's cards grouped under one", () => {
    const ex = buildExample().cards;
    const mine = [
      card("mine-1", "start"),
      card("mine-2", "start", { groupedWith: ex[0].id }),
      card("mine-3", "start", { groupedWith: "mine-1" }),
    ];
    expect(withoutExampleCards([...ex, ...mine])).toEqual([
      mine[0],
      { ...mine[1], groupedWith: null },
      mine[2],
    ]);
    expect(withoutExampleCards(ex)).toEqual([]);
  });
});

describe("retro toMarkdown: grouping and owners", () => {
  it("nests grouped cards under their parent, most-voted first, with vote counts", () => {
    const md = toMarkdown(
      {
        format,
        cards: [
          card("p", "start", { text: "Parent", votes: 1 }),
          card("c1", "start", { text: "Child low", groupedWith: "p" }),
          card("c2", "start", { text: "Child high", votes: 2, groupedWith: "p" }),
        ],
      },
      NOW
    );
    expect(md).toContain(
      "## Start\n\n- Parent (1 vote)\n  - Child high (2 votes)\n  - Child low\n\n## Stop\n\nNo cards."
    );
    expect(md).toContain("## Action items\n\nNo action items yet.\n");
  });

  it("lists action items most-voted first, with owners on one line", () => {
    const md = toMarkdown(
      {
        format,
        cards: [
          card("a", "start", { text: "Low", votes: 1, isActionItem: true }),
          card("b", "stop", {
            text: "High\nprio",
            votes: 3,
            isActionItem: true,
            assignee: " Priya\n(PM) ",
          }),
        ],
      },
      NOW
    );
    expect(md).toContain(
      "## Action items\n\n- High prio — Owner: Priya (PM)\n- Low — No owner yet\n"
    );
  });

  it("keeps the format name and column labels on one line", () => {
    const md = toMarkdown(
      {
        format: {
          ...format,
          name: "Team\nRetro",
          columns: [{ ...format.columns[0], label: "Went\nwell" }],
        },
        cards: [card("a", "start", { text: "Ok" })],
      },
      NOW
    );
    expect(md.split("\n")[0]).toBe("# Retro — 18 Oct 2026 (Team Retro)");
    expect(md).toContain("## Went well\n\n- Ok");
  });

  // Bug: a card grouped under a card that is itself grouped (a board saved
  // before the picker kept groups one level deep) was left out of the export.
  it("lists a card whose group parent is itself grouped instead of dropping it", () => {
    const md = toMarkdown(
      {
        format,
        cards: [
          card("top", "start", { text: "Top" }),
          card("mid", "start", { text: "Middle", groupedWith: "top" }),
          card("deep", "start", { text: "Deep", groupedWith: "mid" }),
          card("stray", "stop", { text: "Stray", groupedWith: "gone" }),
          card("across", "stop", { text: "Across", groupedWith: "top" }),
        ],
      },
      NOW
    );
    for (const text of ["Top", "Middle", "Deep", "Stray", "Across"]) {
      expect(md).toContain(`- ${text}`);
    }
    expect(md).toContain("- Top\n  - Middle\n- Deep");
    expect(md).toContain("## Stop\n\n- Stray\n- Across");
  });
});

describe("retro room message readers", () => {
  const ALICE = "aliceAAAAAAAAAAA";
  const BOB = "bobBBBBBBBBBBBBB";

  it("rebuilds a card intent from known fields only", () => {
    expect(
      readIntentEnv({
        v: 1,
        by: ALICE,
        extra: "dropped",
        intent: { t: "card:add", iid: "abc_123-X", columnKey: "start", text: "  Raw text  ", x: 1 },
      })
    ).toEqual({
      v: 1,
      by: ALICE,
      intent: { t: "card:add", iid: "abc_123-X", columnKey: "start", text: "  Raw text  " },
    });
  });

  it("rebuilds a vote intent, and refuses arrays and over-long ids", () => {
    expect(
      readIntentEnv({ v: 1, by: ALICE, intent: { t: "vote", iid: "i1", cardId: "c1" } })
    ).toEqual({ v: 1, by: ALICE, intent: { t: "vote", iid: "i1", cardId: "c1" } });
    expect(readIntentEnv([1, ALICE])).toBeNull();
    expect(readIntentEnv({ v: 1, by: ALICE, intent: [] })).toBeNull();
    expect(
      readIntentEnv({ v: 1, by: ALICE, intent: { t: "vote", iid: "x".repeat(33), cardId: "c" } })
    ).toBeNull();
    expect(
      readIntentEnv({ v: 1, by: ALICE, intent: { t: "card:add", iid: "a", columnKey: "start" } })
    ).toBeNull();
    expect(
      readIntentEnv({
        v: 1,
        by: ALICE,
        intent: { t: "card:add", iid: "a", columnKey: "start", text: "x".repeat(2001) },
      })
    ).toBeNull();
  });

  it("reads kick and end messages from member ids only", () => {
    expect(readKickMessage({ by: ALICE, id: BOB, extra: 1 })).toEqual({ by: ALICE, id: BOB });
    expect(readKickMessage({ by: ALICE, id: "short" })).toBeNull();
    expect(readKickMessage({ by: "short", id: BOB })).toBeNull();
    expect(readKickMessage(null)).toBeNull();
    expect(readKickMessage([ALICE, BOB])).toBeNull();
    expect(readEndMessage({ by: ALICE })).toEqual({ by: ALICE });
    expect(readEndMessage({ by: 42 })).toBeNull();
    expect(readEndMessage("end")).toBeNull();
  });
});

describe("createIntentLedger", () => {
  it("seeds spent votes, capped at the budget, dropping junk counts", () => {
    expect(createIntentLedger({ votesUsed: { a: 2, b: 7, c: 0, d: -1, e: 1.5 } })).toEqual({
      votesUsed: { a: 2, b: 3 },
      cardsBy: {},
      recent: [],
    });
    expect(createIntentLedger()).toEqual({ votesUsed: {}, cardsBy: {}, recent: [] });
  });
});

describe("timerRemaining", () => {
  const T0 = Date.parse("2026-10-18T10:00:00.000Z");

  it("counts down whole seconds from the anchor while running, never below zero", () => {
    const t = { running: true, remaining: 300, anchoredAt: T0 };
    expect(timerRemaining(t, T0)).toBe(300);
    expect(timerRemaining(t, T0 + 999)).toBe(300);
    expect(timerRemaining(t, T0 + 1000)).toBe(299);
    expect(timerRemaining(t, T0 + 61_500)).toBe(239);
    expect(timerRemaining(t, T0 + 10 * 60_000)).toBe(0);
  });

  it("holds still while paused", () => {
    expect(timerRemaining({ running: false, remaining: 42, anchoredAt: T0 }, T0 + 60_000)).toBe(42);
  });
});

// ── The board's "Group with" picker ─────────────────────────────────

const logger: HistoryLogger = { log: () => {}, toolRunId: "test-run" };
let latest: BoardState;

function Harness({ initial }: { initial: BoardState }) {
  const [state, setState] = useState(initial);
  latest = state;
  return (
    <Board
      state={state}
      onUpdate={(updater) => setState((prev) => updater(prev))}
      onReset={() => {}}
      logger={logger}
    />
  );
}

function writeBoard(cards: RetroCard[]): BoardState {
  return {
    format,
    phase: "write",
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
  };
}

function pickGroup(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

describe("Retro board grouping", () => {
  beforeEach(() => {
    // Radix Select calls these; jsdom doesn't implement them.
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  it("groups a card under another card in its column", () => {
    render(<Harness initial={writeBoard([card("a", "start"), card("b", "start")])} />);
    pickGroup(screen.getAllByRole("combobox", { name: "Group with another card" })[0], "Card b");
    expect(latest.cards.find((c) => c.id === "a")!.groupedWith).toBe("b");
    // Ungroup again: b has no other top-level card to join, so only a's picker is left.
    pickGroup(screen.getByRole("combobox", { name: "Group with another card" }), "No group");
    expect(latest.cards.every((c) => c.groupedWith === null)).toBe(true);
  });

  // Bug: grouping a card that already had cards grouped under it nested them
  // two levels deep, and the board only draws one level, so they vanished.
  it("brings a card's own group along when it joins another group", () => {
    render(
      <Harness
        initial={writeBoard([
          card("a", "start"),
          card("b", "start", { groupedWith: "a" }),
          card("c", "start"),
        ])}
      />
    );
    // Comboboxes in render order: a, b (a's group), c.
    pickGroup(screen.getAllByRole("combobox", { name: "Group with another card" })[0], "Card c");
    expect(latest.cards.map((c) => [c.id, c.groupedWith])).toEqual([
      ["a", "c"],
      ["b", "c"],
      ["c", null],
    ]);
    // Every card is still on the board.
    for (const text of ["Card a", "Card b", "Card c"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });
});
