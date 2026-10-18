import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import { retroFormats } from "@/lib/constants/retro-formats";
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
