import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { Impediment } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/impediments/model";

type Row = Omit<Impediment, "id" | "raisedAt" | "resolvedAt" | "escalatedAt" | "dueDate"> & {
  /** Days before today. */
  raised: number;
  resolved?: number;
  escalated?: number;
  /** Days from today (negative: already past). */
  due?: number;
};

/**
 * A product team three weeks into a quarter. The build server has been
 * down past its due date, so it leads the verdict; the security review is
 * escalated outside the team; one item is due by its expected days rather
 * than a date; three resolved ones give an average time to resolve. Dates
 * are relative to today, so the ages and the overdue flag always read the
 * same.
 */
const ROWS: Row[] = [
  {
    title: "Build server down",
    description: "CI has been red since the runner upgrade; nothing can merge.",
    severity: "critical",
    category: "technical",
    raisedBy: "Jordan",
    owner: "Priya",
    raised: 5,
    due: -3,
  },
  {
    title: "Waiting on the security review for the payments API",
    description: "Release is blocked until the security team signs off.",
    severity: "high",
    category: "external",
    raisedBy: "Alex",
    owner: "Sam",
    raised: 8,
    escalated: 2,
    due: 2,
  },
  {
    title: "Test environment shared with another team",
    severity: "medium",
    category: "organizational",
    raisedBy: "Morgan",
    owner: "Morgan",
    raised: 3,
    expectedResolutionDays: 5,
  },
  {
    title: "Acceptance criteria unclear on the checkout stories",
    severity: "medium",
    category: "process",
    raisedBy: "Priya",
    owner: "Alex",
    raised: 1,
  },
  {
    title: "Flaky end-to-end tests on mobile Safari",
    severity: "low",
    category: "technical",
    raisedBy: "Jordan",
    raised: 2,
  },
  {
    title: "No product owner at refinement",
    severity: "medium",
    category: "process",
    owner: "Morgan",
    raised: 10,
    resolved: 7,
  },
  {
    title: "VPN drops during remote pairing",
    severity: "low",
    category: "technical",
    owner: "Priya",
    raised: 14,
    resolved: 12,
  },
  {
    title: "Design sign-off delayed",
    severity: "high",
    category: "external",
    owner: "Sam",
    raised: 20,
    escalated: 16,
    resolved: 11,
  },
];

export function buildExample(today: string): Impediment[] {
  return ROWS.map(({ raised, resolved, escalated, due, ...rest }, n) => ({
    id: exampleId(`impediment-${n + 1}`),
    ...rest,
    raisedAt: addDays(today, -raised),
    ...(resolved !== undefined ? { resolvedAt: addDays(today, -resolved) } : {}),
    ...(escalated !== undefined ? { escalatedAt: addDays(today, -escalated) } : {}),
    ...(due !== undefined ? { dueDate: addDays(today, due) } : {}),
    source: "manual" as const,
  }));
}

/** The example's rows in `list` (never the user's own). */
export const exampleRows = (list: readonly Impediment[]) => list.filter((i) => isExampleId(i.id));
