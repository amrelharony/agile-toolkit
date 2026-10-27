/**
 * The User Interviews page's reading of the log: the order interviews are
 * listed in, the one-sentence verdict, the anonymised copy every export
 * and the AI prompt take, and where a quote can go on the Opportunity
 * Tree. The counts are lib/interviews' (themes per participant), which
 * tool.user_interviews returns too.
 */

import type { Interview, TreeNode } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  anonymiseInterviews,
  participantCount,
  themeCounts,
  type ThemeCount,
} from "@/lib/interviews/model";
import { nodeTitle, outcomeOf } from "@/lib/opportunity-tree/model";
import { isExampleId } from "@/lib/utils/example-id";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Newest interview first; same-day ones in the order they were logged. */
export function compareInterviews(a: Interview, b: Interview): number {
  const da = (a.date ?? "").slice(0, 10);
  const db = (b.date ?? "").slice(0, 10);
  return da === db ? 0 : da < db ? 1 : -1;
}

/** "2 of 5 people", for a theme's badge. */
export const themeBadge = (t: ThemeCount, people: number) =>
  `${t.participants} of ${plural(people, "person", "people")}`;

/**
 * The one-sentence verdict: the strongest theme and how many participants
 * raised it, or what to do next. With fewer than MIN_SAMPLE.average
 * participants a theme is a hunch, and it says so.
 */
export function interviewsVerdict(interviews: readonly Interview[]): string {
  if (interviews.length === 0) return "No interviews yet.";
  const people = participantCount(interviews);
  const themes = themeCounts(interviews);
  const who = `${plural(interviews.length, "interview")} with ${plural(people, "participant")}`;
  if (themes.length === 0) return `${who}; tag quotes to see the themes.`;
  const top = themes[0];
  const head = `“${top.tag}” is the strongest theme: ${top.participants} of ${plural(people, "participant")} raised it (${plural(top.quotes, "quote")}).`;
  return people < MIN_SAMPLE.average
    ? `${head} With ${plural(people, "participant")} so far, treat it as a hunch.`
    : head;
}

/**
 * The interviews as an anonymised export shows them, keyed by id: each
 * participant becomes "Participant N", numbered by the first interview
 * with them (oldest first, so the numbers don't change as new interviews
 * are logged), and context and quotes go through redactPii.
 */
export function anonymisedById(interviews: readonly Interview[]): Map<string, Interview> {
  const oldestFirst = interviews
    .map((i, at) => ({ i, at }))
    .sort((x, y) => -compareInterviews(x.i, y.i) || x.at - y.at)
    .map((x) => x.i);
  return new Map(anonymiseInterviews(oldestFirst).map((i) => [i.id, i]));
}

/** The interviews to export: anonymised when the toggle is on, in the page's order. */
export function forExport(interviews: readonly Interview[], anonymise: boolean): Interview[] {
  if (!anonymise) return [...interviews];
  const anon = anonymisedById(interviews);
  return interviews.map((i) => anon.get(i.id) ?? i);
}

/* ── Where a quote can go on the tree ────────────────────────────────── */

export interface ParentOption {
  id: string;
  label: string;
}

export interface ParentGroup {
  /** The outcome's node id; null for the opportunities under no outcome. */
  outcomeId: string | null;
  label: string;
  options: ParentOption[];
}

/**
 * The outcomes and opportunities a quote's opportunity can go under, in
 * the tree's order: each outcome with the opportunities it serves, then
 * the opportunities under no outcome. Example nodes are left out, as JTBD
 * leaves them out of its picker, so a quote never lands in data that
 * "Clear example" removes.
 */
export function parentGroups(nodes: readonly TreeNode[]): ParentGroup[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const real = nodes.filter((n) => !isExampleId(n.id));
  const groups = new Map<string | null, ParentGroup>();
  for (const n of real) {
    if (n.kind === "outcome") {
      groups.set(n.id, {
        outcomeId: n.id,
        label: `Outcome: ${nodeTitle(n)}`,
        options: [{ id: n.id, label: `Directly under “${nodeTitle(n)}”` }],
      });
    }
  }
  for (const n of real) {
    if (n.kind !== "opportunity") continue;
    const outcome = outcomeOf(n, byId);
    const key = outcome && groups.has(outcome.id) ? outcome.id : null;
    if (!groups.has(key)) {
      groups.set(key, { outcomeId: null, label: "Not under an outcome", options: [] });
    }
    groups.get(key)!.options.push({ id: n.id, label: `Under “${nodeTitle(n)}”` });
  }
  // Opportunities under no outcome go last.
  const loose = groups.get(null);
  groups.delete(null);
  return [...Array.from(groups.values()), ...(loose ? [loose] : [])];
}
