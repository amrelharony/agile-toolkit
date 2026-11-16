// @vitest-environment node
/**
 * Golden test for Retro Actions' AI task, retro-actions.themes: the past
 * retros' cards in by short id, themes out, the fallback from the words
 * the retros share, and the input's caps (it has to fit a visitor's body
 * limit at 400 cards).
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_VISITOR_MAX_BODY_BYTES } from "@/lib/ai/contract";
import { fallbackThemes, retroActionsThemesTask } from "@/lib/ai/tasks/retro-actions";
import { retroActionsThemesPrompt } from "@/lib/ai/tasks/retro-actions.server";
import { THEME_CARDS_MAX, THEME_CARD_TEXT_MAX, themesInput } from "@/lib/retro/recurring-themes";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";

const sample = retroActionsThemesTask.input.parse(retroActionsThemesTask.sample);

describe("retro-actions.themes", () => {
  it("reasons over many cards with the bigger model", () => {
    expect(retroActionsThemesTask).toMatchObject({
      toolId: "retro-actions",
      tier: "full",
      maxTokens: 8192,
    });
  });

  it("asks for themes from three or more retros, by the cards' ids", () => {
    const system = buildTaskSystem(retroActionsThemesTask, retroActionsThemesPrompt);
    expect(system).toContain("3 or more different retros");
    expect(system).toContain("never about a person");
    const user = buildTaskUser(retroActionsThemesPrompt, sample);
    expect(user).toContain("1 | 2026-09-18");
    expect(user).toContain("c3 | 2 | Flaky tests came back on the payment page");
  });

  it("reads themes and drops a malformed one", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        themes: [
          { name: "Unreliable tests", cardIds: ["c1", "c3", "c5"], count: 3 },
          { name: "", cardIds: ["c2"], count: 1 },
        ],
      }),
      retroActionsThemesTask.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: { themes: [{ name: "Unreliable tests", cardIds: ["c1", "c3", "c5"], count: 3 }] },
    });
  });

  it("falls back to the words three retros share", () => {
    const themes = fallbackThemes(sample.cards);
    expect(themes.map((t) => t.name).sort()).toEqual(["flaky", "staging"]);
    expect(themes.find((t) => t.name === "flaky")).toMatchObject({
      cardIds: ["c1", "c3", "c5"],
      count: 3,
    });
    expect(retroActionsThemesTask.output.safeParse({ themes }).success).toBe(true);
  });

  it("caps its input at 400 cards of 100 characters", () => {
    const full = {
      retros: Array.from({ length: 52 }, (_, i) => ({ n: i + 1, date: "2026-11-12" })),
      cards: Array.from({ length: THEME_CARDS_MAX }, (_, i) => ({
        id: `c${i + 1}`,
        r: (i % 52) + 1,
        text: "x".repeat(THEME_CARD_TEXT_MAX),
      })),
    };
    expect(retroActionsThemesTask.input.safeParse(full).success).toBe(true);
    expect(
      retroActionsThemesTask.input.safeParse({ ...full, cards: [...full.cards, full.cards[0]] })
        .success
    ).toBe(false);
  });

  it("sends what a visitor's request can carry, in any script", () => {
    for (const letter of ["x", "é", "ع", "字"]) {
      const boards = Array.from({ length: 52 }, (_, r) =>
        past(
          `r${r}`,
          r,
          Array.from({ length: 20 }, (_, i) => card(`${r}-${i}`, letter.repeat(150)))
        )
      );
      const { input } = themesInput(boards);
      expect(retroActionsThemesTask.input.safeParse(input).success, letter).toBe(true);
      const bytes = new TextEncoder().encode(
        JSON.stringify({ task: retroActionsThemesTask.id, input })
      ).length;
      expect(bytes, letter).toBeLessThan(TOOL_AI_VISITOR_MAX_BODY_BYTES);
      expect(input.cards.length, letter).toBeGreaterThan(100);
    }
  });
});

function card(id: string, text: string): RetroCard {
  return {
    id,
    columnKey: "start",
    text,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  };
}

function past(id: string, daysAgo: number, cards: RetroCard[]): RetroBoard {
  return {
    id,
    format: retroFormats[0],
    phase: "actions",
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    archivedAt: new Date(Date.UTC(2026, 10, 12) - daysAgo * 86_400_000).toISOString(),
  };
}
