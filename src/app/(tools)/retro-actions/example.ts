import { exampleId } from "@/components/tool-frame/example-data";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import type { HandoffLink, RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { todayIso } from "@/lib/sprints/series";

/** The example in memory: its boards, the hand-off targets that finished, and its sprints' names. */
export interface RetroActionsExample {
  boards: RetroBoard[];
  /** Example hand-off targets that are finished (an impediment resolved). */
  doneTargets: ReadonlySet<string>;
  /** Sprint names for the example boards' `sprintId`s. */
  sprintNames: Readonly<Record<string, string>>;
}

const DAY_MS = 86_400_000;

const formatOf = (id: string): RetroFormat =>
  retroFormats.find((f) => f.id === id) ?? retroFormats[0];

/** The board's first column: where the Retro board files action items it doesn't place. */
const firstColumn = (format: RetroFormat) => format.columns[0]?.key ?? "start";

function action(
  key: string,
  format: RetroFormat,
  text: string,
  extra: Partial<RetroCard> = {}
): RetroCard {
  return {
    id: exampleId(`ra-${key}`),
    columnKey: firstColumn(format),
    text,
    votes: 0,
    groupedWith: null,
    isActionItem: true,
    assignee: "",
    discussing: false,
    ...extra,
  };
}

function board(key: string, format: RetroFormat, archivedAt: string, cards: RetroCard[]) {
  const sprintId = exampleId(`sprint-${key}`);
  return {
    id: exampleId(`retro-${key}`),
    format,
    phase: "actions" as const,
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    archivedAt,
    sprintId,
  } satisfies RetroBoard;
}

/**
 * A checkout team's last three retros, two weeks apart, so the page has a
 * follow-through to show. Sprint 12 got three of four actions done (one by
 * a copy carried into Sprint 13); Sprint 13 also three of four, one of them
 * closed when the impediment it was sent to was resolved, and one carried
 * on into Sprint 14; Sprint 14's retro was three days ago and only one of
 * its four is done yet, one already overdue. 7 of 12 overall.
 *
 * Everything carries `example-` ids and stays in the page's memory: the
 * cockpit and the agent never count it.
 */
export function buildExample(now: Date = new Date()): RetroActionsExample {
  const at = (daysAgo: number, hour = 10) => {
    const d = new Date(now.getTime() - daysAgo * DAY_MS);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const day = (daysAgo: number) => todayIso(new Date(now.getTime() - daysAgo * DAY_MS));
  const ssc = formatOf("start-stop-continue");
  const fourLs = formatOf("4ls");
  const msg = formatOf("mad-sad-glad");
  const impediment: HandoffLink = {
    route: "impediment",
    targetId: exampleId("imp-staging"),
    at: day(26),
  };

  const sprint12 = board("12", ssc, at(31), [
    action("12-1", ssc, "Pair on the flaky checkout UI tests", {
      assignee: "Sam",
      done: true,
      doneAt: at(27, 16),
    }),
    action("12-2", ssc, "Write acceptance criteria before refinement", {
      assignee: "Priya",
      done: true,
      doneAt: at(24, 11),
    }),
    action("12-3", ssc, "Move the release checklist into the repo", { assignee: "Dev" }),
    action("12-4", ssc, "Update the Definition of Done for accessibility", { assignee: "Alex" }),
  ]);
  const sprint13 = board("13", fourLs, at(17), [
    action("13-1", fourLs, "Move the release checklist into the repo", {
      assignee: "Dev",
      carriedFrom: exampleId("ra-12-3"),
      done: true,
      doneAt: at(12, 15),
    }),
    action("13-2", fourLs, "Timebox refinement to 60 minutes", {
      assignee: "Priya",
      done: true,
      doneAt: at(15, 9),
    }),
    action("13-3", fourLs, "Get the staging sandbox fixed", {
      assignee: "Sam",
      sentTo: [impediment],
    }),
    action("13-4", fourLs, "Rotate the release captain each sprint", { assignee: "Alex" }),
  ]);
  const sprint14 = board("14", msg, at(3), [
    action("14-1", msg, "Rotate the release captain each sprint", {
      assignee: "Alex",
      carriedFrom: exampleId("ra-13-4"),
    }),
    action("14-2", msg, "Write the on-call guide", { assignee: "Dev", dueDate: day(-7) }),
    action("14-3", msg, "Demo with production-like data", {
      assignee: "Priya",
      done: true,
      doneAt: at(1, 14),
    }),
    action("14-4", msg, "Book the payments team for a dependency review", {
      assignee: "Sam",
      dueDate: day(1),
    }),
  ]);

  return {
    boards: [sprint12, sprint13, sprint14],
    doneTargets: new Set([impediment.targetId]),
    sprintNames: {
      [exampleId("sprint-12")]: "Sprint 12",
      [exampleId("sprint-13")]: "Sprint 13",
      [exampleId("sprint-14")]: "Sprint 14",
    },
  };
}
