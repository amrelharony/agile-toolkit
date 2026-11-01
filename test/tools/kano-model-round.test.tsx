import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import type { PairRoundResult } from "@/lib/realtime/vote-room/pair";
import type { SavePairRound } from "@/components/collab/vote-room/save-round";

/**
 * The Kano page's save for a live survey round (the kit's panel stubbed to
 * hand its onSave out): a live round's joints become class counts with
 * source "room", a round where every feature was withheld or is gone is
 * refused (false, with the reason), and Undo leaves a feature edited since
 * alone.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const panel = vi.hoisted(() => ({
  onSave: null as null | SavePairRound,
  sheetIds: [] as string[],
}));
vi.mock("@/components/collab/vote-room", () => ({
  VoteRoundPanel: ({
    onSave,
    sheet,
  }: {
    onSave: SavePairRound;
    sheet: { items: { id: string }[] } | null;
  }) => {
    panel.onSave = onSave;
    panel.sheetIds = sheet?.items.map((i) => i.id) ?? [];
    return null;
  },
}));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { KanoModelClient } from "@/app/(tools)/kano-model/kano-model-client";

const state = () => useWorkspaceStore.getState();
const stored = (id: string) => (state().prioritizations ?? []).find((r) => r.id === id);
const feature = (id: string, title: string, fields: Record<string, number | string> = {}) =>
  ({
    id,
    framework: "kano",
    title,
    fields,
    status: "open",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) as PrioritizationItem;

/** A 5×5 joint with `n` people in cell (first, second). */
const joint = (cells: [number, number, number][]) => {
  const out = new Array<number>(25).fill(0);
  for (const [f, s, n] of cells) out[f * 5 + s] = n;
  return out;
};

const result = (items: PairRoundResult["items"]): PairRoundResult => ({
  kind: "pair",
  roundId: "round_abcdefgh",
  tool: "kano-model",
  sheetId: "kano-survey",
  title: "Kano survey",
  prompts: { first: "If it has this, how do you feel?", second: "If it doesn't?" },
  answers: ["I like it", "I expect it", "I'm neutral", "I can live with it", "I dislike it"],
  closedAt: "2026-10-27T10:00:00.000Z",
  minN: 3,
  ballots: 5,
  source: "live",
  items,
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <KanoModelClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  panel.onSave = null;
  useWorkspaceStore.setState({
    prioritizations: [feature("dm", "Dark mode"), feature("sso", "SSO")],
  });
});

describe("Kano: saving a live round", () => {
  it("stores each revealed feature's class counts from its joint, source room", () => {
    renderPage();
    expect(panel.sheetIds).toEqual(["dm", "sso"]);
    let undo: ReturnType<SavePairRound> = undefined;
    act(() => {
      undo = panel.onSave!(
        result([
          // like/neutral = A ×3, like/dislike = O ×1, must/dislike = M ×1
          {
            id: "dm",
            text: "Dark mode",
            responses: 5,
            joint: joint([
              [0, 2, 3],
              [0, 4, 1],
              [1, 4, 1],
            ]),
          },
          { id: "sso", text: "SSO", responses: 2, joint: null },
        ])
      );
    });
    expect(typeof undo).toBe("function");
    expect(stored("dm")?.fields).toEqual({
      kanoA: 3,
      kanoO: 1,
      kanoM: 1,
      kanoI: 0,
      kanoR: 0,
      kanoQ: 0,
      kanoN: 5,
      kanoSource: "room",
      kanoRoundId: "round_abcdefgh",
      kanoAt: "2026-10-27T10:00:00.000Z",
    });
    expect(stored("dm")).toMatchObject({ score: 3, status: "scored" });
    expect(stored("sso")?.fields).toEqual({});
    act(() => (undo as () => void)());
    expect(stored("dm")?.fields).toEqual({});
  });

  it("refuses a round where every feature was withheld, and says so", () => {
    renderPage();
    let saved: ReturnType<SavePairRound> = undefined;
    act(() => {
      saved = panel.onSave!(
        result([
          { id: "dm", text: "Dark mode", responses: 2, joint: null },
          { id: "sso", text: "SSO", responses: 1, joint: null },
        ])
      );
    });
    expect(saved).toBe(false);
    expect(toastSpy.error).toHaveBeenCalledWith("No feature had 3 answers, so nothing was saved.");
    expect(stored("dm")?.fields).toEqual({});
  });

  it("refuses a round whose features are gone", () => {
    renderPage();
    act(() => state().removePrioritization("dm"));
    let saved: ReturnType<SavePairRound> = undefined;
    act(() => {
      saved = panel.onSave!(
        result([{ id: "dm", text: "Dark mode", responses: 3, joint: joint([[0, 4, 3]]) }])
      );
    });
    expect(saved).toBe(false);
    expect(toastSpy.error).toHaveBeenCalledWith(
      "The round's features are no longer on the list, so nothing was saved."
    );
  });

  it("leaves a feature edited after the round alone on Undo", () => {
    renderPage();
    let undo: ReturnType<SavePairRound> = undefined;
    act(() => {
      undo = panel.onSave!(
        result([{ id: "dm", text: "Dark mode", responses: 3, joint: joint([[0, 4, 3]]) }])
      );
    });
    const edited = { ...stored("dm")!, title: "Dark theme", updatedAt: "2026-10-27T11:00:00Z" };
    act(() => state().upsertPrioritization(edited));
    act(() => (undo as () => void)());
    expect(stored("dm")).toMatchObject({ title: "Dark theme", fields: { kanoO: 3 } });
  });
});
