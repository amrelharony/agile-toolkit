import { exampleId } from "@/components/tool-frame/example-data";
import type {
  HealthCheck,
  HealthCheckEntry,
  HealthDimension,
  HealthTrafficLight,
  Impediment,
  KanbanBoard,
  KanbanCard,
  Sprint,
  StandupEntry,
  Story,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS, KANBAN_BOARD_ID } from "@/lib/stores/workspace-types";
import { todayIso } from "@/lib/sprints/series";
import type { DashboardSources } from "@/lib/health-dashboard/kpis";

const DAY_MS = 86_400_000;

/** The example's sources, without today and the settings (those are the page's). */
export type DashboardExample = Required<
  Pick<
    DashboardSources,
    "sprints" | "stories" | "kanbanBoards" | "healthChecks" | "impediments" | "standupEntries"
  >
>;

const CARD_COLUMNS = { backlog: 5, ready: 5, in_progress: 3, review: 2, done: 99 };

/**
 * A team two weeks into Sprint 15, so every card has something to say: six
 * pointed sprints (four met their commitment: predictability amber) and one
 * spike sprint closed without points (left out), two saved health checks
 * (the latest at 75%, up from 63%), three impediments (one critical),
 * two open standup blockers this week (one already raised as an
 * impediment, so not counted twice) and an older one, and stories and
 * Flow-board cards finished over the last months (cycle time P85 about a
 * week and a half: amber).
 *
 * Everything carries `example-` ids and stays in the page's memory: the
 * workspace, the agent and the other tools never see it.
 */
export function buildExample(now: Date = new Date()): DashboardExample {
  const at = (daysAgo: number, hour = 10) => {
    const d = new Date(now.getTime() - daysAgo * DAY_MS);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const day = (daysAgo: number) => todayIso(new Date(now.getTime() - daysAgo * DAY_MS));

  // Two-week sprints back from the one in progress (started 9 days ago).
  const planned = [20, 22, 24, 24, 26, 25];
  const done = [19, 23, 17, 24, 25, 18];
  const sprints: Sprint[] = planned.map((p, i) => {
    const start = 9 + 14 * (7 - i);
    return {
      id: exampleId(`hd-sprint-${i + 8}`),
      name: `Sprint ${i + 8}`,
      startDate: day(start),
      endDate: day(start - 13),
      pointsPlanned: p,
      pointsCompleted: done[i],
      status: "completed",
    };
  });
  sprints.push(
    {
      id: exampleId("hd-sprint-14"),
      name: "Sprint 14 (spike)",
      startDate: day(23),
      endDate: day(10),
      pointsPlanned: 0,
      pointsCompleted: 0,
      status: "completed",
    },
    {
      id: exampleId("hd-sprint-15"),
      name: "Sprint 15",
      startDate: day(9),
      endDate: day(-4),
      pointsPlanned: 24,
      status: "active",
    }
  );

  // Stories finished over the last 80 days, each with its start.
  const storyDays: [number, number][] = [
    [80, 74],
    [70, 66],
    [62, 60],
    [55, 44],
    [48, 45],
    [40, 37],
    [33, 21],
    [28, 26],
    [20, 15],
    [12, 10],
  ];
  const stories: Story[] = storyDays.map(([started, finished], i) => ({
    id: exampleId(`hd-story-${i + 1}`),
    title: `Checkout story ${i + 1}`,
    points: [3, 5, 2, 8, 3, 5, 8, 2, 5, 3][i],
    status: "done",
    startedAt: at(started),
    doneAt: at(finished, 16),
  }));
  stories.push({
    id: exampleId("hd-story-11"),
    title: "Saved cards for returning shoppers",
    points: 5,
    status: "in_progress",
    sprintId: exampleId("hd-sprint-15"),
    startedAt: at(6),
  });

  const cardDays: [number, number][] = [
    [64, 61],
    [44, 31],
    [30, 29],
    [18, 9],
    [8, 8],
  ];
  const cards: KanbanCard[] = cardDays.map(([started, finished], i) => ({
    id: exampleId(`hd-card-${i + 1}`),
    title: `Support fix ${i + 1}`,
    column: "done",
    class: "standard",
    createdAt: at(started + 2),
    startedAt: at(started),
    completedAt: at(finished, 15),
  }));
  const kanbanBoards: KanbanBoard[] = [{ id: KANBAN_BOARD_ID, cards, wipLimits: CARD_COLUMNS }];

  const lights = (reds: HealthDimension[], yellows: HealthDimension[]) =>
    Object.fromEntries(
      HEALTH_CHECK_DIMENSIONS.map((d) => {
        const light: HealthTrafficLight = reds.includes(d)
          ? "red"
          : yellows.includes(d)
            ? "yellow"
            : "green";
        return [d, { light, trend: "same" as const }];
      })
    ) as HealthCheckEntry["scores"];
  const healthChecks: HealthCheck[] = [
    {
      id: exampleId("hd-health"),
      current: { sprintName: "", scores: lights([], []) },
      history: [
        {
          id: exampleId("hd-check-12"),
          sprintName: "Sprint 12",
          date: day(38),
          scores: lights(["Easy to Release"], ["Speed", "Health of Codebase", "Fun", "Learning"]),
        },
        {
          id: exampleId("hd-check-13"),
          sprintName: "Sprint 13",
          date: day(10),
          scores: lights(["Easy to Release"], ["Speed", "Health of Codebase"]),
        },
      ],
    },
  ];

  const impediments: Impediment[] = [
    {
      id: exampleId("hd-imp-1"),
      title: "Payments sandbox down since Monday",
      severity: "critical",
      raisedAt: day(4),
      source: "standup",
      owner: "Sam",
    },
    {
      id: exampleId("hd-imp-2"),
      title: "Security review queue is two weeks long",
      severity: "high",
      raisedAt: day(16),
      escalatedAt: day(9),
      dueDate: day(2),
      source: "manual",
    },
    {
      id: exampleId("hd-imp-3"),
      title: "Flaky end-to-end tests on CI",
      severity: "medium",
      raisedAt: day(30),
      resolvedAt: day(21),
      source: "retro",
    },
  ];

  const entry = (
    key: string,
    member: string,
    daysAgo: number,
    blockers: string,
    extra: Partial<StandupEntry> = {}
  ): StandupEntry => ({
    id: exampleId(`hd-standup-${key}`),
    member,
    date: day(daysAgo),
    yesterday: "Worked on the checkout stories",
    today: "Carry on",
    blockers,
    timestamp: now.getTime() - daysAgo * DAY_MS,
    mode: "live",
    ...extra,
  });
  const standupEntries: StandupEntry[] = [
    entry("1", "Sam", 4, "Payments sandbox is down", {
      sentTo: [{ route: "impediment", targetId: exampleId("hd-imp-1"), at: day(4) }],
    }),
    entry("2", "Priya", 2, "Waiting on the design for the saved-cards screen"),
    entry("3", "Priya", 1, "Waiting on the design for the saved-cards screen"),
    entry("4", "Dev", 1, ""),
    entry("5", "Alex", 18, "No access to the analytics dashboard"),
  ];

  return { sprints, stories, kanbanBoards, healthChecks, impediments, standupEntries };
}
