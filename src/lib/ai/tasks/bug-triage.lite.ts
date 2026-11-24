/**
 * Bug Triage's AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `bug-triage.ts` and loads on first AI use): the caps, the
 * suggestions without AI, `fitSeverityInput`, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { duplicateGroups } from "@/lib/audience-wall/words";
import { isOpen, oldestFirst, priorityFor, severityByRules } from "@/lib/bug-triage/model";
import type { BugReport } from "@/lib/stores/workspace-types";
import type { SeverityInput, SeverityOutput, SeveritySuggestion } from "./bug-triage";
export type { SeverityInput, SeverityOutput, SeveritySuggestion } from "./bug-triage";

/** The task's id, as the request names it. */
export const SEVERITY_TASK_ID = "bug-triage.severity";

/** At most this many bugs per ask: one triage sitting. */
export const SEVERITY_BUGS_MAX = 20;
/** Other open bugs sent along, for spotting duplicates. */
export const SEVERITY_OPEN_MAX = 100;
/** A bug's id as sent; a longer stored id is left out of the ask. */
export const SEVERITY_ID_MAX = 64;
export const SEVERITY_TITLE_MAX = 200;
/** A bug's steps, expected, what happened and where, joined. */
export const SEVERITY_DETAILS_MAX = 1000;
export const SEVERITY_AREA_MAX = 200;
/** Another open bug's title as sent: enough to tell a duplicate. */
export const SEVERITY_OPEN_TITLE_MAX = 120;
export const SEVERITY_REASON_MAX = 160;

/**
 * The suggestions without AI, one per bug asked about, in their order: the
 * severity from the quick checks and the words (`severityByRules`), the
 * priority that goes with it (`priorityFor`), and, when the title reads like
 * one sent before it or one of the other open bugs, that bug as the one it
 * repeats (Audience Wall's near-duplicate finder).
 */
export function fallbackSeverity({ bugs, open = [] }: SeverityInput): SeverityOutput {
  const asked = bugs.slice(0, SEVERITY_BUGS_MAX);
  const askedIds = new Set(asked.map((b) => b.id));
  // The other open bugs first, so the bug logged first is the one kept.
  const posts = [
    ...open.filter((o) => !askedIds.has(o.id)).map((o) => ({ id: o.id, text: o.title })),
    ...asked.map((b) => ({ id: b.id, text: b.title })),
  ];
  const repeats = new Map<string, string>();
  for (const g of duplicateGroups(posts)) for (const id of g.merge) repeats.set(id, g.keep);
  return {
    suggestions: asked.map((b): SeveritySuggestion => {
      const guess = severityByRules([b.title, b.details].filter(Boolean).join("\n"), b.checks);
      const duplicateOf = askedIds.has(b.id) ? repeats.get(b.id) : undefined;
      return {
        id: b.id,
        severity: guess.severity,
        priority: priorityFor(guess.severity, b.checks),
        reason: guess.reason.slice(0, SEVERITY_REASON_MAX),
        ...(duplicateOf && duplicateOf !== b.id ? { duplicateOf } : {}),
      };
    }),
  };
}

export const bugTriageSeverityTask = lazyAiTask<SeverityInput, SeverityOutput>(
  { id: SEVERITY_TASK_ID, toolId: "bug-triage", fallback: fallbackSeverity },
  () => import("./bug-triage").then((m) => m.bugTriageSeverityTask)
);

/**
 * The ask, trimmed until its request (`{task, input}`) fits `budget` bytes:
 * the bugs' details go first, from the last bug up, then the other open
 * bugs from the end, then whole bugs from the end (one is always kept).
 * Twenty long bugs in a non-Latin script with a full list of open bugs can
 * pass the route's cap. The input as it is when it already fits.
 */
export function fitSeverityInput(
  input: SeverityInput,
  budget: number = TOOL_AI_BODY_BUDGET
): SeverityInput {
  const size = (next: SeverityInput) => jsonBytes({ task: SEVERITY_TASK_ID, input: next });
  if (size(input) <= budget) return input;
  const bugs = input.bugs.map((b) => ({ ...b }));
  let open = [...(input.open ?? [])];
  const current = (): SeverityInput => ({ ...input, bugs, ...(input.open ? { open } : {}) });
  for (let i = bugs.length - 1; i >= 0 && size(current()) > budget; i--) delete bugs[i].details;
  while (open.length > 0 && size(current()) > budget) open = open.slice(0, -1);
  while (bugs.length > 1 && size(current()) > budget) bugs.pop();
  return current();
}

const clip = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

/** One bug as the ask sends it: never who reported it. */
export function askForBug(bug: BugReport): SeverityInput["bugs"][number] {
  const details = [bug.steps, bug.expected, bug.actual, bug.environment]
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, SEVERITY_DETAILS_MAX);
  const area = bug.area ? clip(bug.area, SEVERITY_AREA_MAX) : "";
  return {
    id: bug.id,
    title: clip(bug.title, SEVERITY_TITLE_MAX),
    ...(details ? { details } : {}),
    ...(area ? { area } : {}),
    ...(bug.checks ? { checks: { ...bug.checks } } : {}),
  };
}

/**
 * The ask for `queue` (the first 20 with a usable id, as given), with the
 * other open bugs, oldest first, for spotting duplicates; fitted to the
 * request budget. Null when nothing in the queue can be asked about.
 */
export function severityAsk(
  queue: readonly BugReport[],
  all: readonly BugReport[]
): SeverityInput | null {
  const usable = (b: BugReport) => b.id.length <= SEVERITY_ID_MAX && b.title.trim() !== "";
  const bugs = queue.filter(usable).slice(0, SEVERITY_BUGS_MAX);
  if (bugs.length === 0) return null;
  const asked = new Set(bugs.map((b) => b.id));
  const open = oldestFirst(all.filter((b) => isOpen(b) && usable(b) && !asked.has(b.id)))
    .slice(0, SEVERITY_OPEN_MAX)
    .map((b) => ({ id: b.id, title: clip(b.title, SEVERITY_OPEN_TITLE_MAX) }));
  return fitSeverityInput({ bugs: bugs.map(askForBug), ...(open.length > 0 ? { open } : {}) });
}
