import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment, RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { RETRO_CURRENT_ID, collectRetroActions } from "@/lib/retro/actions";

/**
 * Retro Actions' Export menu offers CSV beside Markdown: one row per action
 * with its summary, assignee, due date and whether it is done, so the list
 * can go into a tracker or a spreadsheet without retyping.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData, markdown }: { csvData?: Csv; markdown?: string }) => {
    exported.csv = csvData;
    return <pre data-testid="export-markdown">{markdown}</pre>;
  },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));

import { RetroActionsTracker } from "@/app/(tools)/retro-actions/tracker";
import { ACTIONS_CSV_HEADERS, actionsToCsv } from "@/app/(tools)/retro-actions/csv";

const card = (id: string, text: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...extra,
});
const board = (id: string, cards: RetroCard[], extra: Partial<RetroBoard> = {}): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...extra,
});

const LAST = board(
  "retro:2026-10-05T10:00:00.000Z",
  [
    card("l1", "Pair on the\nflaky tests", { assignee: " Sam ", dueDate: "2026-10-15" }),
    card("l2", "Shorter planning", { done: true, doneAt: "2026-10-10T09:00:00.000Z" }),
    card("l3", "Fix the staging sandbox", {
      sentTo: [{ route: "impediment", targetId: "imp-1", at: "2026-10-06" }],
    }),
    card("l4", "Not an action", { isActionItem: false }),
  ],
  { archivedAt: "2026-10-05T10:00:00.000Z" }
);
const CURRENT = board(RETRO_CURRENT_ID, [
  card("c1", "Write the on-call guide", { assignee: "Priya" }),
]);
const IMP_RESOLVED: Impediment = {
  id: "imp-1",
  title: "Staging sandbox",
  severity: "high",
  raisedAt: "2026-10-06",
  resolvedAt: "2026-10-12",
};

beforeEach(() => {
  exported.csv = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  useWorkspaceStore.setState({
    retroBoards: [LAST, CURRENT],
    impediments: [IMP_RESOLVED],
    kanbanBoards: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ retroBoards: [], impediments: [], kanbanBoards: [] });
});

describe("retro actions as CSV", () => {
  it("has a row per action: summary, assignee, due date, done", () => {
    const actions = collectRetroActions([LAST, CURRENT], { today: "2026-10-22" });
    expect(actionsToCsv(actions)).toEqual({
      headers: ["Summary", "Assignee", "Due date", "Done"],
      rows: [
        ["Write the on-call guide", "Priya", "", "No"],
        // One line, the owner's name trimmed.
        ["Pair on the flaky tests", "Sam", "2026-10-15", "No"],
        ["Shorter planning", "", "", "Yes"],
        ["Fix the staging sandbox", "", "", "No"],
      ],
    });
    expect(actionsToCsv([])).toEqual({ headers: ACTIONS_CSV_HEADERS, rows: [] });
  });

  it("counts an action done once the impediment it was sent to is resolved", () => {
    const actions = collectRetroActions([LAST], {
      today: "2026-10-22",
      targetDone: (link) => link.targetId === "imp-1",
    });
    expect(actionsToCsv(actions).rows.at(-1)).toEqual(["Fix the staging sandbox", "", "", "Yes"]);
  });

  it("is handed to the Export menu with every action, whatever the filter shows", () => {
    render(<RetroActionsTracker />, { wrapper: TooltipProvider });
    // The page opens on the open actions; the export still lists the done ones.
    expect(exported.csv?.headers).toEqual(["Summary", "Assignee", "Due date", "Done"]);
    expect(exported.csv?.rows).toEqual([
      ["Write the on-call guide", "Priya", "", "No"],
      ["Pair on the flaky tests", "Sam", "2026-10-15", "No"],
      ["Shorter planning", "", "", "Yes"],
      ["Fix the staging sandbox", "", "", "Yes"],
    ]);
  });
});
