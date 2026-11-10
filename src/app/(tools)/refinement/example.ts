import { exampleId } from "@/components/tool-frame/example-data";
import type { Story } from "@/lib/stores/workspace-types";
import type { Criterion } from "./store";

const DAY_MS = 86_400_000;

interface Row {
  title: string;
  points?: number;
  priorityScore: number;
  /** Indexes into the criteria that passed, and the day of the check (days ago). */
  check?: { met: "all" | number[]; daysAgo: number; ready: boolean };
  /** What the panel shows beside the ticks: the story's criteria, notes and key. */
  details?: Pick<Story, "acceptanceCriteria" | "notes" | "ticketKey">;
}

/**
 * A banking app team's backlog, three refinement sessions in. Three stories
 * are ready; the statement export is waiting on a dependency, the bill
 * split and tablet login have no points yet (one never discussed), and the
 * insights story is too big to fit a sprint. Its readiness checks give the
 * pass-rate trend six points, enough for a trend but not for control limits.
 */
const ROWS: Row[] = [
  {
    title: "Freeze a lost card from the app",
    points: 5,
    priorityScore: 90,
    check: { met: "all", daysAgo: 20, ready: true },
  },
  {
    title: "Show pending transactions in the feed",
    points: 3,
    priorityScore: 85,
    check: { met: "all", daysAgo: 13, ready: true },
  },
  {
    title: "Export statements as PDF",
    points: 8,
    priorityScore: 80,
    // Everything but "Dependencies identified": the PDF service isn't picked.
    check: { met: [0, 1, 2, 4, 5, 6, 7], daysAgo: 6, ready: false },
    details: {
      acceptanceCriteria:
        "- A statement for any of the last 24 months\n- The figures match the ones in the app\n- It opens on a phone without zooming",
      notes: "Waiting on the choice of PDF service.",
      ticketKey: "BANK-214",
    },
  },
  {
    title: "Split a bill with contacts",
    priorityScore: 70,
    check: { met: [0, 1], daysAgo: 6, ready: false },
  },
  {
    title: "Spending insights by category",
    points: 13,
    priorityScore: 60,
    // Too big: it doesn't fit a sprint and needs splitting.
    check: { met: [0, 1, 2, 3], daysAgo: 13, ready: false },
    details: {
      notes:
        "Covers every account, card and currency at once. Try Check the story: it may split by data.",
    },
  },
  { title: "Biometric login on tablets", priorityScore: 55 },
  { title: "Dark mode for the app", points: 2, priorityScore: 40 },
  {
    title: "Recurring transfers between own accounts",
    points: 5,
    priorityScore: 75,
    check: { met: "all", daysAgo: 1, ready: true },
  },
];

/**
 * The example session's stories, checked against the team's current
 * criteria (whatever they are), with "example-" ids. They live in the
 * refinement store only, never in the workspace backlog.
 */
export function buildExample(criteria: readonly Criterion[], now: Date = new Date()): Story[] {
  return ROWS.map((row, i) => {
    const story: Story = {
      id: exampleId(`refinement-${i + 1}`),
      title: row.title,
      status: "backlog",
      priorityScore: row.priorityScore,
      ...(row.points ? { points: row.points } : {}),
      ...row.details,
    };
    if (!row.check) return story;
    const met = row.check.met;
    const checked =
      met === "all" ? criteria.map((c) => c.id) : met.flatMap((n) => criteria[n]?.id ?? []);
    return {
      ...story,
      readiness: {
        checked,
        // Ready only when the criteria really are all met; a team with a
        // shorter list still sees an honest example.
        ready: row.check.ready && checked.length === criteria.length && criteria.length > 0,
        updatedAt: new Date(now.getTime() - row.check.daysAgo * DAY_MS).toISOString(),
      },
    };
  });
}
