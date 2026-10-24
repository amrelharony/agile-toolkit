import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { RetroFacts } from "@/lib/retro/facts";
import { sayDoRatio } from "@/lib/sprints/metrics";
import type { BoardState, RetroCard } from "./types";

type Row = [
  columnKey: string,
  text: string,
  votes: number,
  extra?: Partial<Pick<RetroCard, "isActionItem" | "assignee" | "groupedWith">>,
];

/**
 * A mobile checkout team's sprint retro, already voted and in the Actions
 * phase. Flaky tests are the clear winner; late merges after the code freeze
 * are the surprise runner-up; two pairs of cards tie. The two top Start cards
 * are action items with owners.
 */
const ROWS: Row[] = [
  ["start", "Pair on the flaky checkout UI tests", 5, { isActionItem: true, assignee: "Sam (QA)" }],
  [
    "start",
    "Write acceptance criteria before refinement, not during it",
    3,
    { isActionItem: true, assignee: "Priya (PM)" },
  ],
  ["start", "Share a staff beta build every Friday", 1],
  ["stop", "Merging to main after the Thursday code freeze", 4],
  ["stop", "Standups that run past 30 minutes", 2],
  ["stop", "Solving design questions in standup", 0, { groupedWith: exampleId("retro-5") }],
  ["continue", "Mob reviews on the new payment form", 3],
  ["continue", "Shipping risky changes behind feature flags", 2],
];

/** The example board: Start / Stop / Continue, every card id `example-…`. */
export function buildExample(): BoardState {
  return {
    format: retroFormats.find((f) => f.id === "start-stop-continue") ?? retroFormats[0],
    phase: "actions",
    cards: ROWS.map(([columnKey, text, votes, extra], i) => ({
      id: exampleId(`retro-${i + 1}`),
      columnKey,
      text,
      votes,
      groupedWith: null,
      isActionItem: false,
      assignee: "",
      discussing: false,
      ...extra,
    })),
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
  };
}

/** The user's own cards: example cards removed, and own cards grouped under one ungrouped. */
export function withoutExampleCards(cards: readonly RetroCard[]): RetroCard[] {
  return cards
    .filter((c) => !isExampleId(c.id))
    .map((c) => (isExampleId(c.groupedWith) ? { ...c, groupedWith: null } : c));
}

/**
 * What the example retro opens with: the facts of the example team's own
 * Sprint 14, fixed here, so the example never reads (or counts towards) a
 * real sprint. The example board names no sprint, so no real sprint's
 * cockpit or facts take it for its retro either.
 *
 * The checkout team partly met its goal, finished 26 of 34 points with most
 * of them in the last few days, raised three impediments (one still open),
 * felt middling, did two of the last retro's three actions and carried the
 * third, and gave each other two kudos.
 */
export const EXAMPLE_FACTS: RetroFacts = {
  sprintId: exampleId("retro-sprint-14"),
  sprintName: "Sprint 14",
  dated: true,
  goal: "Customers can pay with a saved card in the mobile checkout",
  goalOutcome: {
    met: "partly",
    note: "Android shipped; iOS waits on the store review",
    decidedAt: "2026-10-23T15:00:00.000Z",
  },
  committed: 34,
  completed: 26,
  fromStories: true,
  sayDo: sayDoRatio(34, 26),
  burndown: {
    shape: "late",
    lateShare: 0.69,
    sentence: "Most of the done points (69%) landed in the sprint's last third.",
  },
  impediments: { raised: 3, resolvedInSprint: 2, stillOpen: 1, escalated: 1 },
  mood: { average: 3.2, checkIns: 24, people: 6 },
  followThrough: {
    boardId: exampleId("retro-previous"),
    retroLabel: "Start / Stop / Continue · 9 Oct 2026",
    archivedAt: "2026-10-09T15:00:00.000Z",
    agreed: 3,
    done: 2,
    carried: 1,
    open: 0,
    rate: 2 / 3,
  },
  kudos: [
    {
      id: exampleId("kudos-1"),
      toName: "Sam (QA)",
      fromName: "Priya (PM)",
      message: "Stayed late to untangle the flaky checkout tests before the release.",
      sentAt: "2026-10-15T16:20:00.000Z",
    },
    {
      id: exampleId("kudos-2"),
      toName: "Dev",
      fromName: "Sam (QA)",
      message: "Paired with me on the payment form review and caught two edge cases.",
      sentAt: "2026-10-21T11:05:00.000Z",
    },
  ],
};
