import { describe, expect, it } from "vitest";
import { getNextStepRule } from "@/lib/tools/next-steps";
import type {
  CapacityPlan,
  DependencyMap,
  Sprint,
  Story,
  Workspace,
} from "@/lib/stores/workspace-types";

/**
 * Next steps for the Plan-the-sprint tools (Phase 2): each reads the
 * workspace and points somewhere real, ignores example rows, and stays
 * quiet when nothing applies.
 */

const steps = (toolId: string, ws: Partial<Workspace>) => {
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  return rule.steps(rule.select(ws as Workspace));
};
const ids = (toolId: string, ws: Partial<Workspace>) => steps(toolId, ws).map((s) => s.id);

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 20,
  status: "active",
  ...over,
});
const story = (over: Partial<Story> = {}): Story => ({
  id: "st",
  title: "Story",
  status: "backlog",
  points: 3,
  ...over,
});

describe("sprint-planning", () => {
  it("offers carry-over, estimation and the cockpit when they apply", () => {
    const ws = {
      sprints: [sprint({ id: "s1", name: "Sprint 1", status: "completed" }), sprint()],
      stories: [
        story({ id: "a", sprintId: "s1", status: "in_progress", points: 5 }),
        story({ id: "b", sprintId: "s2", status: "todo", points: undefined }),
      ],
    };
    const out = steps("sprint-planning", ws);
    expect(out.map((s) => s.id)).toEqual([
      "planning-carry-over",
      "planning-estimate",
      "planning-cockpit",
    ]);
    expect(out[0].detail).toBe(
      "Sprint 1 left 1 story (5 points) unfinished. Carry them into the next sprint or send them back to the backlog."
    );
    expect(out[2].href).toBe("/sprint?sprint=s2");
  });

  it("stays quiet with nothing left over, everything sized, and no active sprint", () => {
    expect(
      ids("sprint-planning", {
        sprints: [sprint({ status: "planned" })],
        stories: [story({ sprintId: "s2", status: "todo" })],
      })
    ).toEqual([]);
  });

  it("ignores example sprints and stories", () => {
    expect(
      ids("sprint-planning", {
        sprints: [sprint({ id: "example-s", status: "completed" })],
        stories: [story({ id: "example-a", sprintId: "example-s", status: "todo" })],
      })
    ).toEqual([]);
  });
});

describe("capacity-planner", () => {
  const plan = (id: string): CapacityPlan => ({
    id,
    sprintId: "s2",
    members: [{ id: "m", name: "Ana", role: "Dev", availability: 100, daysOff: 0 }],
    config: {
      sprintDays: 10,
      ceremonyOverhead: 10,
      focusFactor: 0.8,
      hoursPerDay: 8,
      pointsCommitted: "",
    },
  });

  it("points at Sprint Planning with the forecast once the sprint has its own plan", () => {
    const out = steps("capacity-planner", {
      sprints: [sprint({ id: "s0", status: "completed", pointsCompleted: 24 }), sprint()],
      capacityPlans: [plan("capacity-planner:sprint:s2")],
    });
    expect(out).toEqual([
      expect.objectContaining({
        id: "capacity-plan-sprint",
        detail: "Capacity is 100% of a normal sprint, so plan about 24 points in Sprint 2.",
        href: "/sprint-planning?sprint=s2",
      }),
    ]);
  });

  it("stays quiet on the general plan alone", () => {
    expect(
      ids("capacity-planner", {
        sprints: [sprint()],
        capacityPlans: [plan("capacity-planner:current")],
      })
    ).toEqual([]);
  });
});

describe("sprint-goal", () => {
  it("asks to plan around a set goal, with the story count", () => {
    const out = steps("sprint-goal", {
      sprints: [sprint({ goal: "Ship guest checkout" })],
      stories: [story({ sprintId: "s2" }), story({ id: "b", sprintId: "s2" })],
    });
    expect(out[0]).toMatchObject({
      label: "Plan Sprint 2 around its goal",
      detail: "2 stories are planned into Sprint 2. Check each one serves the goal.",
      href: "/sprint-planning?sprint=s2",
    });
  });

  it("stays quiet without a goal or with a closed sprint", () => {
    expect(ids("sprint-goal", { sprints: [sprint({ goal: "  " })], stories: [] })).toEqual([]);
    expect(
      ids("sprint-goal", { sprints: [sprint({ goal: "x", status: "completed" })], stories: [] })
    ).toEqual([]);
  });
});

describe("estimation, refinement and poker", () => {
  const log = (queue: { id: string; title: string }[]) => [
    { id: "pokerEstimationLog:current", estimates: [], queue } as never,
  ];

  it("planning-poker: plan stories saved from a session", () => {
    expect(
      ids("planning-poker", {
        stories: [story({ sourceRef: { tool: "planning-poker", id: "r1" } })],
      })
    ).toEqual(["poker-plan"]);
    expect(
      ids("planning-poker", {
        stories: [story({ sourceRef: { tool: "planning-poker", id: "r1" }, sprintId: "s2" })],
      })
    ).toEqual([]);
  });

  it("estimation-guide: estimate a waiting queue", () => {
    expect(
      ids("estimation-guide", { pokerEstimationLogs: log([{ id: "q", title: "A" }]) })
    ).toEqual(["guide-poker"]);
    expect(ids("estimation-guide", { pokerEstimationLogs: log([]) })).toEqual([]);
  });

  it("refinement: estimate the queue, then plan the ready stories", () => {
    expect(
      ids("refinement", {
        pokerEstimationLogs: log([{ id: "q", title: "A" }]),
        stories: [story({ readiness: { checked: [], ready: true, updatedAt: "x" } })],
      })
    ).toEqual(["refinement-poker", "refinement-plan"]);
    // Ready but unsized isn't plannable yet.
    expect(
      ids("refinement", {
        stories: [
          story({ points: undefined, readiness: { checked: [], ready: true, updatedAt: "x" } }),
        ],
      })
    ).toEqual([]);
  });
});

describe("story-mapper and walking-skeleton", () => {
  const map = (estimates: (string | undefined)[]) => ({
    id: "story-mapper:current",
    steps: [{ id: "step", name: "Browse" }],
    slices: [
      {
        id: "mvp",
        name: "MVP",
        cards: {
          step: estimates.map((estimate, i) => ({
            id: `c${i}`,
            title: `Card ${i}`,
            description: "",
            color: "",
            estimate,
          })),
        },
      },
    ],
  });

  it("asks to size unestimated cards and to plan the first priced slice", () => {
    const out = steps("story-mapper", { storyMaps: [map(["3", "5", "", "L"])] });
    expect(out.map((s) => s.id)).toEqual(["map-estimate", "map-release"]);
    expect(out[0].detail).toMatch(/^2 stories on the map have no points/);
    expect(out[1]).toMatchObject({
      detail: "“MVP” totals 8 points. See when it can ship at your velocity.",
      href: "/release-planner?slice=mvp",
    });
  });

  it("stays quiet with no map", () => {
    expect(ids("story-mapper", { storyMaps: [] })).toEqual([]);
  });

  it("walking-skeleton: plan open steps sent to the backlog", () => {
    const src = { tool: "walking-skeleton", id: "w1" };
    expect(ids("walking-skeleton", { stories: [story({ sourceRef: src })] })).toEqual([
      "skeleton-plan",
    ]);
    expect(
      ids("walking-skeleton", { stories: [story({ sourceRef: src, status: "done" })] })
    ).toEqual([]);
  });
});

describe("release-planner, jtbd-mapper and epic-roadmap", () => {
  it("release-planner: unsized open stories and too little history", () => {
    expect(
      ids("release-planner", {
        sprints: [sprint({ status: "completed", pointsCompleted: 10 })],
        stories: [story({ points: undefined })],
      })
    ).toEqual(["release-estimate", "release-history"]);
    const four = Array.from({ length: 4 }, (_, i) =>
      sprint({ id: `c${i}`, status: "completed", pointsCompleted: 0 })
    );
    expect(ids("release-planner", { sprints: four, stories: [story()] })).toEqual([]);
  });

  it("jtbd-mapper: size stories from jobs, else choose jobs to build", () => {
    const src = { tool: "jtbd-mapper", id: "j1" };
    expect(
      ids("jtbd-mapper", {
        jobStories: [],
        stories: [story({ sourceRef: src, points: undefined })],
      })
    ).toEqual(["jobs-estimate"]);
    const jobs = ["a", "b", "c"].map(
      (id) => ({ id, situation: "s", motivation: "m", outcome: "o" }) as never
    );
    expect(ids("jtbd-mapper", { jobStories: jobs, stories: [] })).toEqual(["jobs-choose"]);
    expect(ids("jtbd-mapper", { jobStories: jobs, stories: [story({ sourceRef: src })] })).toEqual(
      []
    );
  });

  it("epic-roadmap: break down epics with no linked stories", () => {
    const docs = [
      {
        id: "epicRoadmap:current",
        epics: [
          {
            id: "e1",
            title: "Checkout",
            startQuarter: "2026-Q4",
            endQuarter: "2026-Q4",
            progress: 0,
          },
          {
            id: "e2",
            title: "Search",
            startQuarter: "2026-Q4",
            endQuarter: "2027-Q1",
            progress: 0,
          },
        ],
      },
    ];
    expect(
      steps("epic-roadmap", { epicRoadmaps: docs, stories: [story({ epicId: "e1" })] })[0].detail
    ).toBe("1 epic has no linked stories, so its progress is typed by hand.");
    expect(
      ids("epic-roadmap", {
        epicRoadmaps: docs,
        stories: [story({ epicId: "e1" }), story({ id: "b", epicId: "e2" })],
      })
    ).toEqual([]);
  });
});

describe("dependencies", () => {
  const depMap = (edges: DependencyMap["edges"]): DependencyMap[] => [
    {
      id: "dependency-map:current",
      nodes: [
        { id: "a", label: "Checkout" },
        { id: "b", label: "Payments" },
      ],
      edges,
    },
  ];

  it("dependency-map: chase overdue edges at the Scrum of Scrums", () => {
    expect(
      ids("dependency-map", {
        dependencyMaps: depMap([{ id: "e", from: "a", to: "b", kind: "needs", due: "2000-01-01" }]),
      })
    ).toEqual(["deps-overdue"]);
    expect(
      ids("dependency-map", {
        dependencyMaps: depMap([
          { id: "e", from: "a", to: "b", kind: "needs", due: "2000-01-01", status: "resolved" },
        ]),
      })
    ).toEqual([]);
  });

  it("pi-planning: review open edges that came from the PI board", () => {
    const fromPi = { tool: "pi-planning", id: "item1" };
    expect(
      ids("pi-planning", {
        dependencyMaps: depMap([{ id: "e", from: "a", to: "b", kind: "needs", sourceRef: fromPi }]),
      })
    ).toEqual(["pi-dependencies"]);
    expect(
      ids("pi-planning", {
        dependencyMaps: depMap([
          {
            id: "e",
            from: "a",
            to: "b",
            kind: "needs",
            sourceRef: { tool: "pi-planning", id: "example-1" },
          },
        ]),
      })
    ).toEqual([]);
  });

  it("scrum-of-scrums: raise open blockers that have no impediment", () => {
    const entry = {
      id: "b1",
      meetingDate: "2026-10-23",
      team: "Checkout",
      kind: "blocker" as const,
      text: "Waiting on the payments sandbox",
      status: "open" as const,
      loggedAt: "2026-10-23T09:00:00Z",
    };
    expect(ids("scrum-of-scrums", { sosEntries: [entry], impediments: [] })).toEqual([
      "sos-impediments",
    ]);
    expect(
      ids("scrum-of-scrums", {
        sosEntries: [entry],
        impediments: [
          {
            id: "i",
            title: "x",
            severity: "high",
            raisedAt: "2026-10-23",
            sourceRef: { tool: "scrum-of-scrums", id: "b1" },
          },
        ],
      })
    ).toEqual([]);
  });
});
