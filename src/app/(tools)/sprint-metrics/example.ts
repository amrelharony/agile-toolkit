import { exampleId } from "@/components/tool-frame/example-data";
import type {
  Sprint,
  SprintSeries,
  Story,
  StorySprintChange,
  StoryStatusChange,
} from "@/lib/stores/workspace-types";
import { dayDate, endDateFor, todayIso } from "@/lib/sprints/series";

/**
 * Sprint Metrics' example, shown in memory only (fake finished sprints
 * would feed velocity, forecasts and agents): six closed two-week sprints
 * and the running one, with the stories whose moves the trend reads, each
 * carrying its sprint history and status history.
 *
 * The pattern to spot: Sprint 3 took on two stories mid-sprint, missed its
 * commitment and carried 13 points into Sprint 4; the team then committed
 * less and stopped adding work, and the last three sprints met their
 * commitment.
 */
export interface MetricsExample {
  sprints: Sprint[];
  stories: Story[];
  series: SprintSeries[];
  /** The running sprint. */
  current: Sprint;
}

const LENGTH = 13;

/** Per closed sprint: commitment, points done, stories added and removed mid-sprint, carried over. */
const SPEC = [
  { planned: 34, completed: 29, added: [3], removed: [], carried: [5] },
  { planned: 32, completed: 31, added: [], removed: [2], carried: [] },
  { planned: 36, completed: 23, added: [5, 3], removed: [], carried: [8, 5] },
  { planned: 30, completed: 28, added: [], removed: [2], carried: [] },
  { planned: 31, completed: 30, added: [], removed: [], carried: [3] },
  { planned: 30, completed: 31, added: [], removed: [], carried: [] },
] as const;

const TITLES = [
  "Saved addresses",
  "Order history filters",
  "Gift wrapping option",
  "Delivery slot picker",
  "Promo code at checkout",
  "Wishlist sharing",
  "Low-stock badge",
  "Returns label download",
  "Courier tracking link",
  "Reorder in one tap",
];

export function buildExample(today: string = todayIso()): MetricsExample {
  // The running sprint started 5 days ago; the closed ones run back from it.
  const currentStart = dayDate({ startDate: today }, -5) ?? today;
  const startOf = (i: number) =>
    dayDate({ startDate: currentStart }, -(LENGTH + 1) * (SPEC.length - i)) ?? currentStart;

  const sprints: Sprint[] = SPEC.map((spec, i) => {
    const start = startOf(i);
    return {
      id: exampleId(`trend-sprint-${i + 1}`),
      name: `Sprint ${i + 1}`,
      startDate: start,
      endDate: endDateFor(start, LENGTH),
      pointsPlanned: spec.planned,
      pointsCompleted: spec.completed,
      status: "completed",
    };
  });
  const current: Sprint = {
    id: exampleId(`trend-sprint-${SPEC.length + 1}`),
    name: `Sprint ${SPEC.length + 1}`,
    startDate: currentStart,
    endDate: endDateFor(currentStart, LENGTH),
    goal: "Customers can reorder in one tap",
    pointsPlanned: 30,
    status: "active",
  };
  const all = [...sprints, current];

  // Noon UTC is the same calendar day in nearly every time zone.
  const at = (s: Sprint, day: number) => `${dayDate(s, day) ?? s.startDate}T12:00:00.000Z`;
  let n = 0;
  const title = () => TITLES[n++ % TITLES.length];
  const stories: Story[] = [];
  const story = (
    sprintId: string | undefined,
    points: number,
    status: Story["status"],
    sprintHistory: StorySprintChange[],
    statusHistory: StoryStatusChange[]
  ) => {
    stories.push({
      id: exampleId(`trend-story-${stories.length + 1}`),
      title: title(),
      points,
      status,
      ...(sprintId ? { sprintId } : {}),
      createdAt: sprintHistory[0]?.at,
      sprintHistory,
      statusHistory,
    });
  };

  SPEC.forEach((spec, i) => {
    const s = sprints[i];
    const next = all[i + 1];
    // Planned on day 0 and finished: the sprint's planning, on the record.
    story(
      s.id,
      5,
      "done",
      [{ sprintId: s.id, at: at(s, 0), points: 5 }],
      [
        { status: "todo", at: at(s, 0) },
        { status: "in_progress", from: "todo", at: at(s, 1) },
        { status: "done", from: "in_progress", at: at(s, 6) },
      ]
    );
    for (const points of spec.added) {
      // Joined on day 3 and was finished.
      story(
        s.id,
        points,
        "done",
        [{ sprintId: s.id, at: at(s, 3), points }],
        [
          { status: "todo", at: at(s, 3) },
          { status: "in_progress", from: "todo", at: at(s, 4) },
          { status: "done", from: "in_progress", at: at(s, 8) },
        ]
      );
    }
    for (const points of spec.removed) {
      // Planned on day 0, sent back to the backlog on day 5.
      story(
        undefined,
        points,
        "backlog",
        [
          { sprintId: s.id, at: at(s, 0), points },
          { from: s.id, at: at(s, 5), points },
        ],
        [
          { status: "todo", at: at(s, 0) },
          { status: "backlog", from: "todo", at: at(s, 5) },
        ]
      );
    }
    for (const points of spec.carried) {
      // Started, unfinished at the close, carried into the next sprint.
      story(
        next.id,
        points,
        next === current ? "in_progress" : "done",
        [
          { sprintId: s.id, at: at(s, 0), points },
          { sprintId: next.id, from: s.id, at: at(s, LENGTH), points, carriedOver: true },
        ],
        [
          { status: "todo", at: at(s, 0) },
          { status: "in_progress", from: "todo", at: at(s, 6) },
          ...(next === current
            ? []
            : [{ status: "done" as const, from: "in_progress" as const, at: at(next, 4) }]),
        ]
      );
    }
  });

  return { sprints: all, stories, series: [], current };
}
