import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MoodEntry, MoodPulse, Sprint } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { averageScore, sprintScores } from "@/lib/sprints/compare";
import { fmt } from "@/lib/charts/chart-text";
import { moodDuring } from "@/lib/team/mood";
import { registry } from "@/lib/actions/registry";

/**
 * Mood pulses count wherever mood is read, so one number holds: the Sprint
 * Comparison page and the Sprint cockpit's rating count anonymous pulse
 * answers as `tool.sprint_compare` does, and the retro's facts say which
 * check-ins were anonymous instead of "by 0 people".
 */

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/app/(tools)/sprint-compare/charts", () => ({ SprintRadarChart: () => null }));
vi.mock("@/app/(tools)/burndown/charts", () => ({ BurndownChart: () => null }));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE: d } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [d, () => {}] };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SprintCompareClient } from "@/app/(tools)/sprint-compare/sprint-compare-client";
import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";
import { factLines } from "@/app/(tools)/retro/facts-text";
import { retroFacts } from "@/lib/retro/facts";
import "@/lib/actions/tools/sprint-compare";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const DONE: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-09-28",
  endDate: "2026-10-09",
  pointsPlanned: 30,
  pointsCompleted: 27,
  status: "completed",
};
const ACTIVE: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  pointsPlanned: 30,
  status: "active",
};

const pulse = (id: string, date: string, counts: Partial<MoodPulse["counts"]>): MoodPulse => ({
  id,
  date,
  counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...counts },
  source: "room",
  createdAt: `${date}T09:00:00.000Z`,
});
const named = (id: string, memberId: string, date: string, score: MoodEntry["score"]) =>
  ({ id, memberId, date, score }) as MoodEntry;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
  window.localStorage.clear();
  resetSelectedSprint();
  useSprintMigrationStore.setState({ status: "idle" });
});
afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    sprints: [],
    sprintSeries: [],
    stories: [],
    moodEntries: [],
    moodPulses: [],
  });
});

describe("pulses count on every page that reads mood", () => {
  it("Sprint Comparison's Team Happiness is the agent's, from anonymous pulses alone", async () => {
    useWorkspaceStore.setState({
      sprints: [DONE],
      sprintSeries: [],
      stories: [],
      moodEntries: [],
      moodPulses: [pulse("p1", "2026-10-01", { 4: 3 }), pulse("p2", "2026-10-06", { 3: 2, 5: 1 })],
    });
    const r = (await registry.get("tool.sprint_compare.list_state")!.handler({}, ctx())) as {
      sprints: { id: string; scores: Record<string, { value: number | null }> }[];
    };
    const agent = r.sprints.find((s) => s.id === "s1")!.scores["Team Happiness"].value;
    expect(agent).not.toBeNull();
    render(<SprintCompareClient />);
    const happiness = screen.getByRole("spinbutton", { name: "Team Happiness for Sprint 1" });
    // The prefill the page suggests is the agent's number.
    expect(happiness).toHaveAttribute("placeholder", String(agent));
  });

  it("the cockpit's average rating counts the pulses too", () => {
    const pulses = [pulse("p1", "2026-10-13", { 2: 3 }), pulse("p2", "2026-10-15", { 1: 2, 2: 2 })];
    useWorkspaceStore.setState({
      sprints: [DONE, ACTIVE],
      sprintSeries: [],
      stories: [],
      moodEntries: [],
      moodPulses: pulses,
      teamMembers: [],
      standupEntries: [],
      impediments: [],
      retroBoards: [],
      sprintReviews: [],
    });
    const { container } = render(
      <TooltipProvider>
        <SprintCockpit />
      </TooltipProvider>
    );
    const withPulses = averageScore(
      sprintScores({ sprint: ACTIVE, sprints: [DONE, ACTIVE], stories: [], moodPulses: pulses })
    );
    const without = averageScore(
      sprintScores({ sprint: ACTIVE, sprints: [DONE, ACTIVE], stories: [] })
    );
    expect(withPulses).not.toBe(without);
    expect(container.querySelector('[data-tile="rating"]')?.textContent).toContain(
      fmt(withPulses!)
    );
  });

  it("the retro's facts say which check-ins were anonymous, never 'by 0 people'", () => {
    const pulses = [pulse("p1", "2026-10-13", { 4: 3 }), pulse("p2", "2026-10-15", { 3: 3 })];
    const facts = (moodEntries: MoodEntry[]) =>
      retroFacts({
        sprint: ACTIVE,
        sprints: [DONE, ACTIVE],
        stories: [],
        moodEntries,
        moodPulses: pulses,
        today: "2026-10-20",
      });
    const moodSentence = (moodEntries: MoodEntry[]) =>
      factLines(facts(moodEntries)).find((l) => l.key === "mood")!.sentence;

    expect(moodDuring([], "2026-10-12", "2026-10-23", pulses)).toMatchObject({
      checkIns: 6,
      people: 0,
      anonymous: 6,
    });
    expect(moodSentence([])).toBe("Average mood 3.5 out of 5, from 6 check-ins, all anonymous.");
    expect(
      moodSentence([named("a", "m1", "2026-10-14", 5), named("b", "m2", "2026-10-14", 5)])
    ).toBe("Average mood 3.9 out of 5, from 8 check-ins (6 anonymous, 2 by 2 people).");
    expect(moodSentence([])).not.toMatch(/by 0 people/);
  });
});
