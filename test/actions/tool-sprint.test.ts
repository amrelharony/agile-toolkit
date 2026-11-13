/**
 * tool.sprint.risk: the Sprint Cockpit's goal check for Amr, read from the
 * same workspace rows as the page, with example rows left out.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment, InterruptItem, Sprint, Story } from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/sprint";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 9",
  startDate: "2026-11-02",
  endDate: "2026-11-12",
  goal: "Refunds go out the same day",
  pointsPlanned: 20,
  status: "active",
  interruptBuffer: { points: 4 },
};

const story = (over: Partial<Story>): Story => ({
  id: "st",
  title: "A story",
  points: 5,
  status: "todo",
  sprintId: "s1",
  ...over,
});

type RiskResult = {
  found: boolean;
  reason?: string;
  sprint: { id: string; name: string; goal?: string };
  day: number | null;
  lengthDays: number;
  applies: boolean;
  level: string;
  headline: string;
  reasons: { id: string; level: string; text: string; tryThis: string }[];
  note: string;
  facts: {
    blockedStories: { id: string; title: string }[];
    impediments: { open: number; severe: number };
    interrupts: { state: string; usedPoints: number; bufferPoints: number | null } | null;
  };
};

const run = async (params: Record<string, unknown> = {}) =>
  (await registry.get("tool.sprint.risk")!.handler(params, ctx())) as RiskResult;

function seed({
  sprints = [SPRINT],
  stories = [] as Story[],
  impediments = [] as Impediment[],
  interruptItems = [] as InterruptItem[],
} = {}) {
  useWorkspaceStore.setState({
    sprints,
    sprintSeries: [],
    stories,
    impediments,
    interruptItems,
    ceremonyCadences: [],
  });
}

beforeEach(() => seed());

describe("tool.sprint.risk", () => {
  it("is a read action with a server handler", () => {
    const action = registry.get("tool.sprint.risk");
    expect(action?.category).toBe("read");
    expect(action?.toolId).toBe("tool.sprint");
    expect(typeof action?.mcpHandler).toBe("function");
  });

  it("says when there is no sprint to read", async () => {
    seed({ sprints: [] });
    expect(await run()).toEqual({ found: false, reason: "no_sprints" });
    seed();
    expect(await run({ sprintId: "nope" })).toEqual({ found: false, reason: "sprint_not_found" });
  });

  it("reads the active sprint's goal check from the board, impediments and buffer", async () => {
    seed({
      stories: [
        story({ id: "a", status: "in_progress", blocked: true, title: "Refund API" }),
        story({ id: "b", points: 15 }),
        story({ id: "example-x", blocked: true }),
      ],
      impediments: [
        {
          id: "i1",
          title: "Bank sandbox down",
          severity: "critical",
          raisedAt: "2026-11-03",
        },
        { id: "example-i", title: "x", severity: "critical", raisedAt: "2026-11-03" },
      ],
      interruptItems: [
        {
          id: "n1",
          sprintId: "s1",
          title: "Outage",
          kind: "incident",
          size: 3,
          emergency: true,
          loggedAt: "2026-11-04T09:00:00.000Z",
        },
      ],
    });
    const r = await run({ today: "2026-11-05" });
    expect(r.found).toBe(true);
    expect(r.sprint).toEqual({
      id: "s1",
      name: "Sprint 9",
      status: "active",
      goal: "Refunds go out the same day",
    });
    expect(r).toMatchObject({ day: 3, lengthDays: 10, applies: true, level: "at_risk" });
    expect(r.reasons.map((x) => x.id)).toEqual(
      expect.arrayContaining(["impediments", "blocked", "interrupts"])
    );
    expect(r.reasons[0].level).toBe("at_risk");
    expect(r.facts.blockedStories).toEqual([{ id: "a", title: "Refund API" }]);
    expect(r.facts.impediments).toMatchObject({ open: 1, severe: 1 });
    expect(r.facts.interrupts).toMatchObject({ state: "watch", usedPoints: 3, bufferPoints: 4 });
    expect(r.note.startsWith("The sprint goal is at risk.")).toBe(true);
    expect(r.note).toContain("Try this:");
  });

  it("doesn't judge a sprint before it starts", async () => {
    const r = await run({ today: "2026-10-30" });
    expect(r).toMatchObject({ applies: false, level: "none", reasons: [] });
    expect(r.headline).toBe("Sprint 9 hasn't started yet, so there is no pace to judge.");
  });

  it("leaves example sprints out", async () => {
    seed({ sprints: [{ ...SPRINT, id: "example-preview-sprint-5" }] });
    expect(await run()).toEqual({ found: false, reason: "no_sprints" });
  });
});
