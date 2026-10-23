import { exampleId } from "@/components/tool-frame/example-data";
import type { Epic, Story } from "@/lib/stores/workspace-types";
import { currentQuarterIndex, quarterLabel } from "@/lib/roadmap/quarters";

type Row = [
  key: string,
  title: string,
  /** Quarters from now: -1 is last quarter. */
  from: number,
  to: number,
  owner: string,
  color: string,
  /** Typed progress, used only while no stories are linked. */
  progress: number,
  description?: string,
];

/**
 * A SaaS team's year: last quarter's audit log is late, onboarding ends
 * this quarter, billing is under way with one story still unsized (so it
 * rolls up by story count), and offline mode has no stories yet, so it
 * shows a typed figure. Quarters are relative to today, so the example
 * always sits around "now".
 */
const ROWS: Row[] = [
  [
    "audit",
    "Audit log for admins",
    -2,
    -1,
    "Priya",
    "chart-5",
    0,
    "Who changed what and when, exportable for compliance reviews.",
  ],
  [
    "onboarding",
    "Self-serve onboarding",
    -1,
    0,
    "Priya",
    "chart-1",
    0,
    "New teams set up without a sales call.",
  ],
  ["billing", "Usage-based billing", 0, 1, "Sam", "chart-3", 0],
  ["offline", "Mobile offline mode", 1, 2, "Lee", "chart-4", 10],
];

const epicId = (key: string) => exampleId(`epic-${key}`);

export function buildExample(now: Date = new Date()): Epic[] {
  const q = currentQuarterIndex(now);
  return ROWS.map(([key, title, from, to, owner, color, progress, description]) => ({
    id: epicId(key),
    title,
    startQuarter: quarterLabel(q + from),
    endQuarter: quarterLabel(q + to),
    progress,
    owner,
    color,
    ...(description ? { description } : {}),
  }));
}

type StoryRow = [key: string, epic: string, title: string, points: number | null, done: boolean];

const STORY_ROWS: StoryRow[] = [
  ["audit-1", "audit", "Record every settings change", 5, true],
  ["audit-2", "audit", "Filter the log by person and date", 3, true],
  ["audit-3", "audit", "Export the log as CSV", 2, false],
  ["onb-1", "onboarding", "Sign up with a work email", 3, true],
  ["onb-2", "onboarding", "Invite teammates from the setup checklist", 5, true],
  ["onb-3", "onboarding", "Pick a template for the first project", 8, true],
  ["onb-4", "onboarding", "Connect the calendar", 5, false],
  ["onb-5", "onboarding", "Show a progress bar for setup", 3, false],
  ["bill-1", "billing", "Meter API calls per workspace", 8, true],
  ["bill-2", "billing", "Show usage so far on the billing page", 5, false],
  ["bill-3", "billing", "Invoice the overage each month", 8, false],
  ["bill-4", "billing", "Warn admins at 80% of the plan", null, false],
];

/**
 * The example epics' stories: a read-only preview the roadmap rolls up,
 * never written to the workspace, so loading the example can't put stories
 * into the user's backlog or sprints.
 */
export const EXAMPLE_STORIES: readonly Story[] = STORY_ROWS.map(
  ([key, epic, title, points, done]) => ({
    id: exampleId(`story-${key}`),
    title,
    status: done ? "done" : "todo",
    ...(points === null ? {} : { points }),
    epicId: epicId(epic),
  })
);
