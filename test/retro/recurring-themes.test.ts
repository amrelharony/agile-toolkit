import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import {
  RECURRING_MIN_RETROS,
  THEME_CARDS_MAX,
  THEME_CARD_TEXT_MAX,
  archivedCards,
  archivedRetroCount,
  keywordRecurring,
  recurringThemes,
  themesFromAi,
  themesInput,
} from "@/lib/retro/recurring-themes";
import { buildExample } from "@/app/(tools)/retro-actions/example";

/**
 * Recurring themes across past retros (lib/retro/recurring-themes): words
 * three or more retros' cards share, each card in one theme, carried-over
 * copies and example cards left out, "came back after done", and Amr's
 * groups read against the boards the same way.
 */

const NOW = new Date("2026-11-12T10:00:00Z");
const card = (id: string, text: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});
const past = (id: string, day: string, cards: RetroCard[]): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 300,
  timerRunning: false,
  discussingIndex: 0,
  archivedAt: `${day}T10:00:00.000Z`,
});

describe("the shared words", () => {
  it("make a theme only across three or more retros, most retros first", () => {
    const groups = keywordRecurring([
      { id: "1", retro: "r1", text: "Deploys broke staging" },
      { id: "2", retro: "r2", text: "Staging was slow" },
      { id: "3", retro: "r3", text: "Staging down again" },
      { id: "4", retro: "r1", text: "Lunch was late" },
      { id: "5", retro: "r2", text: "Late lunch again" },
    ]);
    expect(groups).toEqual([
      { name: "staging", cardIds: ["1", "2", "3"], retros: ["r1", "r2", "r3"] },
    ]);
  });

  it("put each card in one theme, the widest first", () => {
    const groups = keywordRecurring(
      [
        { id: "1", retro: "r1", text: "flaky tests" },
        { id: "2", retro: "r2", text: "flaky tests" },
        { id: "3", retro: "r3", text: "flaky tests" },
        { id: "4", retro: "r4", text: "flaky builds" },
      ],
      { minRetros: 3 }
    );
    expect(groups.map((g) => g.name)).toEqual(["flaky"]);
    expect(groups[0].cardIds).toEqual(["1", "2", "3", "4"]);
  });
});

describe("across the boards", () => {
  it("reads past retros only, without carried copies or example cards on a real board", () => {
    const boards = [
      past("a", "2026-10-01", [card("c1", "One"), card("c2", "Copy", { carriedFrom: "c0" })]),
      past("b", "2026-10-15", [card("example-x", "Example"), card("c3", "Two")]),
      { ...past("retro:current", "2026-11-01", [card("c4", "Current")]), archivedAt: undefined },
    ];
    expect(archivedCards(boards).map((c) => c.card.id)).toEqual(["c1", "c3"]);
    expect(archivedRetroCount(boards)).toBe(2);
  });

  it("finds the example's two themes, and that flaky tests came back after done", () => {
    const { boards } = buildExample(NOW);
    const themes = recurringThemes(boards);
    expect(themes.map((t) => t.name).sort()).toEqual(["flaky", "staging"]);
    const flaky = themes.find((t) => t.name === "flaky")!;
    expect(flaky.boardIds).toHaveLength(3);
    expect(flaky.cameBack).toMatchObject({ actionText: "Pair on the flaky checkout UI tests" });
    // Staging's action was closed by its impediment, with no done day: not "came back".
    expect(themes.find((t) => t.name === "staging")!.cameBack).toBeNull();
  });

  it("says a theme came back only for a retro archived after the action was done", () => {
    const done = card("act", "Fix the flaky suite", {
      isActionItem: true,
      done: true,
      doneAt: "2026-10-20T12:00:00.000Z",
    });
    const before = [
      past("r1", "2026-10-01", [card("a", "flaky login test")]),
      past("r2", "2026-10-15", [done, card("b", "flaky checkout")]),
      past("r3", "2026-10-18", [card("c", "flaky again")]),
    ];
    expect(recurringThemes(before)[0].cameBack).toBeNull();
    const after = [...before, past("r4", "2026-11-01", [card("d", "flaky, still")])];
    expect(recurringThemes(after)[0].cameBack).toMatchObject({ actionId: "act", boardId: "r4" });
  });

  it("needs three retros", () => {
    expect(RECURRING_MIN_RETROS).toBe(3);
    const two = [
      past("r1", "2026-10-01", [card("a", "staging down")]),
      past("r2", "2026-10-15", [card("b", "staging slow")]),
    ];
    expect(recurringThemes(two)).toEqual([]);
  });
});

describe("what Amr reads, and his answer", () => {
  it("numbers the retros, gives cards short ids, cuts text, keeps the newest 400", () => {
    const many = Array.from({ length: 5 }, (_, r) =>
      past(
        `r${r}`,
        `2026-10-0${r + 1}`,
        Array.from({ length: 100 }, (_, i) => card(`r${r}-${i}`, `${"word ".repeat(40)}${i}`))
      )
    );
    const { input, ids } = themesInput(many);
    expect(input.cards).toHaveLength(THEME_CARDS_MAX);
    expect(input.cards[0]).toMatchObject({ id: "c1", r: 1 });
    expect(input.cards[0].text.length).toBeLessThanOrEqual(THEME_CARD_TEXT_MAX);
    expect(ids.get("c1")).toBe("r1-0");
    expect(input.retros.map((r) => r.n)).toEqual([1, 2, 3, 4]);
    expect(input.retros[0].date).toBe("2026-10-02");
  });

  it("maps Amr's themes back, drops unknown ids, and keeps only three-retro themes", () => {
    const { boards } = buildExample(NOW);
    const { input, ids } = themesInput(boards);
    const byText = (t: string) => input.cards.find((c) => c.text.startsWith(t))!.id;
    const themes = themesFromAi(boards, ids, [
      {
        name: "Unreliable tests",
        cardIds: [
          byText("Flaky UI tests"),
          byText("Flaky tests came back"),
          byText("Flaky tests again"),
          "c999",
        ],
      },
      { name: "Two retros only", cardIds: [byText("Staging was down"), byText("Staging data")] },
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ name: "Unreliable tests" });
    expect(themes[0].cardIds).toHaveLength(3);
  });
});
