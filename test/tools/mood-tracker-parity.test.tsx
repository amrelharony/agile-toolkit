import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MoodEntry, MoodPulse, Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { averageScore, sprintScores } from "@/lib/sprints/compare";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { fmt } from "@/lib/charts/chart-text";
import { moodDuring } from "@/lib/team/mood";
import { retroFormats } from "@/lib/constants/retro-formats";
import { registry } from "@/lib/actions/registry";

/**
 * Mood pulses count wherever mood is read, so one number holds: the Sprint
 * Comparison page and the Sprint cockpit's rating count anonymous pulse
 * answers as `tool.sprint_compare` does, and the retro's facts say which
 * check-ins were anonymous instead of "by 0 people".
 */

// The MCP path lists the server's rows: here, the workspace's own, by kind,
// so the agent on either path reads exactly what the pages read.
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const STORE_KEY: Record<string, string> = {
    "workspace:sprint": "sprints",
    "workspace:sprintSeries": "sprintSeries",
    "workspace:story": "stories",
    "workspace:sprintGoal": "sprintGoals",
    "workspace:moodEntry": "moodEntries",
    "workspace:moodPulse": "moodPulses",
    "workspace:healthCheck": "healthChecks",
    "workspace:impediment": "impediments",
    "workspace:kudos": "kudos",
    "workspace:retroBoard": "retroBoards",
  };
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) => {
      const { useWorkspaceStore: store } = await import("@/lib/stores/workspace-store");
      const key = STORE_KEY[kind];
      const rows = key ? (store.getState() as unknown as Record<string, unknown>)[key] : undefined;
      return Array.isArray(rows) ? rows : [];
    }),
  };
});
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
// What each page hands Export and Copy, by file name, so a report can be read.
const exported = vi.hoisted(() => new Map<string, string | undefined>());
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ filename, markdown }: { filename: string; markdown?: string }) => {
    exported.set(filename, markdown);
    return null;
  },
}));
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
import { useBoardFacts } from "@/app/(tools)/retro/use-board-facts";
import { retroFacts, type RetroFacts } from "@/lib/retro/facts";
import "@/lib/actions/tools/sprint-compare";
import "@/lib/actions/tools/retro";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});

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
  exported.clear();
  resetSelectedSprint();
  useSprintMigrationStore.setState({ status: "idle" });
});
afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    sprints: [],
    sprintSeries: [],
    stories: [],
    sprintGoals: [],
    moodEntries: [],
    moodPulses: [],
    impediments: [],
    kudos: [],
    retroBoards: [],
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

/* ── Page and agent, with pulses only, with both, and with none ──────────── */

// Check-ins in both sprints' windows: Sprint 1 is the one Sprint Comparison
// compares (the finished one), Sprint 2 the cockpit's and the retro's.
const PULSES = [
  pulse("p1", "2026-10-01", { 4: 3 }),
  pulse("p2", "2026-10-06", { 3: 2, 5: 1 }),
  pulse("p3", "2026-10-13", { 2: 3 }),
  pulse("p4", "2026-10-15", { 3: 2, 4: 2 }),
];
const NAMED = [
  named("a", "m1", "2026-10-02", 2),
  named("b", "m2", "2026-10-02", 1),
  named("c", "m1", "2026-10-14", 5),
  named("d", "m2", "2026-10-14", 4),
  named("e", "m1", "2026-10-16", 3),
];
// A goal answer, so the cockpit's rating has a number with no mood at all.
const GOALS: SprintGoal[] = [
  {
    id: goalDocId(ACTIVE.id),
    sprintId: ACTIVE.id,
    businessObjective: "",
    goal: "Ship the export",
    criteria: [],
    keyResults: [],
    outcome: { met: "partly", decidedAt: "2026-10-19T16:00:00.000Z" },
  },
];

const SCENARIOS = [
  {
    name: "only anonymous pulses",
    moodEntries: [] as MoodEntry[],
    moodPulses: PULSES,
    retroLine: "Average mood 2.9 out of 5, from 7 check-ins, all anonymous.",
  },
  {
    name: "named check-ins and pulses",
    moodEntries: NAMED,
    moodPulses: PULSES,
    retroLine: "Average mood 3.2 out of 5, from 10 check-ins (7 anonymous, 3 by 2 people).",
  },
  {
    name: "no check-ins",
    moodEntries: [] as MoodEntry[],
    moodPulses: [] as MoodPulse[],
    retroLine: "No mood check-ins this sprint.",
  },
];

type Listed = {
  sprints: {
    id: string;
    scores: Record<string, { value: number | null; basis: string }>;
    average: number | null;
  }[];
};

/** tool.sprint_compare.list_state, after checking the MCP path says the same. */
async function compareState(params: { sprintIds?: string[] }): Promise<Listed> {
  const action = registry.get("tool.sprint_compare.list_state")!;
  const browser = (await action.handler(params, ctx())) as Listed;
  expect(await action.mcpHandler!(params, ctx("mcp"))).toEqual(browser);
  return browser;
}

/** tool.retro.list_state's facts for a sprint, after checking the MCP path says the same. */
async function retroState(sprintId: string): Promise<RetroFacts> {
  const action = registry.get("tool.retro.list_state")!;
  const browser = (await action.handler({ sprintId }, ctx())) as { facts: RetroFacts };
  const mcp = (await action.mcpHandler!({ sprintId }, ctx("mcp"))) as { facts: RetroFacts };
  expect(mcp.facts).toEqual(browser.facts);
  return browser.facts;
}

const moodLineOf = (f: RetroFacts) => factLines(f).find((l) => l.key === "mood")!.sentence;

describe.each(SCENARIOS)("page and agent agree for a sprint with $name", (sc) => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      sprints: [DONE, ACTIVE],
      sprintSeries: [],
      stories: [],
      sprintGoals: GOALS,
      moodEntries: sc.moodEntries,
      moodPulses: sc.moodPulses,
      healthChecks: [],
      teamMembers: [],
      standupEntries: [],
      impediments: [],
      kudos: [],
      retroBoards: [],
      sprintReviews: [],
    });
  });

  it("Sprint Comparison's Team Happiness is tool.sprint_compare.list_state's", async () => {
    const listed = await compareState({});
    const happiness = listed.sprints.find((s) => s.id === DONE.id)!.scores["Team Happiness"];
    expect(happiness.value === null).toBe(sc.moodPulses.length === 0);
    render(<SprintCompareClient />);
    const box = screen.getByRole("spinbutton", { name: "Team Happiness for Sprint 1" });
    expect(box).toHaveAttribute(
      "placeholder",
      happiness.value === null ? "–" : String(happiness.value)
    );
    // The words under the box are the agent's basis too ("…, all anonymous").
    expect(box.closest("[data-dimension]")).toHaveTextContent(happiness.basis);
  });

  it("the cockpit's rating is the agent's average for the sprint", async () => {
    const { average } = (await compareState({ sprintIds: [ACTIVE.id] })).sprints[0];
    expect(average).not.toBeNull();
    if (sc.moodPulses.length > 0) {
      // The pulses move the rating, so a cockpit that dropped them would differ.
      const withoutPulses = averageScore(
        sprintScores({
          sprint: ACTIVE,
          sprints: [DONE, ACTIVE],
          stories: [],
          goals: GOALS,
          moodEntries: sc.moodEntries,
        })
      );
      expect(withoutPulses).not.toBe(average);
    }
    const { container } = render(
      <TooltipProvider>
        <SprintCockpit />
      </TooltipProvider>
    );
    expect(container.querySelector('[data-tile="rating"]')?.textContent).toMatch(
      new RegExp(`Average rating${fmt(average!).replace(".", "\\.")}\\s*/ 10`)
    );
    // The exported sprint report rates it the same, under the same label.
    expect(exported.get("sprint-report-sprint-2")).toContain(
      `| Average rating | ${fmt(average!)} / 10 | From Sprint Comparison |`
    );
  });

  it("the retro's facts line is tool.retro.list_state's", async () => {
    const agent = await retroState(ACTIVE.id);
    const { result } = renderHook(() =>
      useBoardFacts({ sprintId: ACTIVE.id, cards: [], format: retroFormats[0] })
    );
    const page = result.current.facts!;
    expect(page.mood).toEqual(agent.mood);
    expect(moodLineOf(page)).toBe(moodLineOf(agent));
    expect(moodLineOf(agent)).toBe(sc.retroLine);
    expect(moodLineOf(agent)).not.toMatch(/by 0 people/);
  });
});
