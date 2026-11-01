import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { HEALTH_CHECK_ID } from "@/lib/stores/workspace-types";
import type { Questionnaire, VoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { SaveVoteRound } from "@/components/collab/vote-room/save-round";
import { emptyHealthCheck, healthQuestionnaire } from "@/lib/health-check/score";
import { moodQuestionnaire } from "@/lib/team/mood";

/**
 * A round a tool can't use is refused, not shown as saved: a Health Check
 * round where every dimension was withheld, or a Mood round whose one
 * question was. Only a live round gets there (the count entry needs one
 * question at minN), and live rooms are off in jsdom, so the panel here is
 * the end of a revealed live round: the kit's own Save round, on a result.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/app/(tools)/health-check/charts", () => ({ HealthTrendChart: () => null }));
vi.mock("@/app/(tools)/mood-tracker/charts", () => ({ DailyMoodChart: () => null }));

const room = vi.hoisted(() => ({ result: null as VoteRoundResult | null }));
vi.mock("@/components/collab/vote-room", async () => {
  const { useSaveRound } = await vi.importActual<
    typeof import("@/components/collab/vote-room/save-round")
  >("@/components/collab/vote-room/save-round");
  return {
    VoteRoundPanel: ({ onSave }: { onSave: SaveVoteRound }) => {
      const { save, isSaved } = useSaveRound(onSave);
      const saved = isSaved(room.result?.roundId);
      return (
        <button type="button" disabled={saved} onClick={() => save(room.result)}>
          {saved ? "Round saved" : "Save round"}
        </button>
      );
    },
  };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";
import { MoodTrackerClient } from "@/app/(tools)/mood-tracker/mood-tracker-client";

let rounds = 0;
/** A revealed live round on `q`: each question's counts, or null where it was withheld. */
function liveRound(
  tool: VoteRoomTool,
  q: Questionnaire,
  distributions: (number[] | null)[],
  over: Partial<VoteRoundResult> = {}
): VoteRoundResult {
  rounds += 1;
  return {
    roundId: `round-${rounds}`,
    tool,
    questionnaireId: q.id,
    title: q.title,
    scale: q.scale,
    closedAt: "2026-10-26T10:00:00.000Z",
    minN: 3,
    ballots: 4,
    source: "live",
    questions: q.questions.map((x, i) => {
      const d = distributions[i] ?? null;
      return {
        id: x.id,
        text: x.text,
        responses: d ? d.reduce((a, b) => a + b, 0) : 2,
        distribution: d,
      };
    }),
    ...over,
  };
}

const saveButton = () => screen.getByRole("button", { name: /^(Save round|Round saved)$/ });
const press = () => fireEvent.click(saveButton());
const savedToast = () => toastSpy.mock.calls.some(([label]) => label === "Saved the round");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  room.result = null;
  useWorkspaceStore.setState({
    healthChecks: [],
    sprints: [],
    retroBoards: [],
    teamMembers: [],
    moodEntries: [],
    moodPulses: [],
    moodTrackerDocs: [],
  });
});
afterEach(() => vi.useRealTimers());

describe("Health Check refuses a round it can't use", () => {
  const q = healthQuestionnaire(emptyHealthCheck())!;
  const renderPage = () =>
    render(
      <TooltipProvider>
        <HealthCheckClient />
      </TooltipProvider>
    );
  const stored = () =>
    useWorkspaceStore.getState().healthChecks?.find((d) => d.id === HEALTH_CHECK_ID);

  it("says no dimension had enough answers and keeps Save round, when every one was withheld", () => {
    renderPage();
    room.result = liveRound("health-check", q, []);
    press();
    expect(toastSpy.error).toHaveBeenCalledWith(
      "No dimension had 3 answers, so nothing was saved."
    );
    expect(stored()).toBeUndefined();
    expect(savedToast()).toBe(false);
    expect(saveButton()).toHaveTextContent("Save round");
    expect(saveButton()).toBeEnabled();
  });

  it("says so when the round's dimensions have left the check", () => {
    renderPage();
    room.result = liveRound("health-check", q, [[4, 0, 0]], {
      questions: [{ id: "gone", text: "Gone dimension", responses: 4, distribution: [4, 0, 0] }],
    });
    press();
    expect(toastSpy.error).toHaveBeenCalledWith(
      "The round's dimensions are no longer in the check, so nothing was saved."
    );
    expect(saveButton()).toBeEnabled();
  });

  it("still saves a round where some dimensions show", () => {
    renderPage();
    room.result = liveRound("health-check", q, [[4, 0, 0]]);
    press();
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(savedToast()).toBe(true);
    expect(stored()?.current).toMatchObject({ source: "room", responses: 4 });
    expect(stored()?.current.rated).toHaveLength(1);
    expect(saveButton()).toHaveTextContent("Round saved");
    expect(saveButton()).toBeDisabled();
  });
});

describe("Mood Tracker refuses a pulse whose question was withheld", () => {
  const q = moodQuestionnaire();
  const renderPage = () =>
    render(
      <TooltipProvider>
        <MoodTrackerClient />
      </TooltipProvider>
    );

  it("says why, keeps no pulse and keeps Save round", () => {
    renderPage();
    room.result = liveRound("mood-tracker", q, [null]);
    press();
    expect(toastSpy.error).toHaveBeenCalledWith(
      "The question had fewer than 3 answers, so nothing was saved."
    );
    expect(useWorkspaceStore.getState().moodPulses).toEqual([]);
    expect(savedToast()).toBe(false);
    expect(saveButton()).toHaveTextContent("Save round");
    expect(saveButton()).toBeEnabled();
  });

  it("still saves a pulse with enough answers", () => {
    renderPage();
    room.result = liveRound("mood-tracker", q, [[0, 1, 0, 2, 0]]);
    press();
    expect(useWorkspaceStore.getState().moodPulses).toHaveLength(1);
    expect(saveButton()).toHaveTextContent("Round saved");
  });
});
