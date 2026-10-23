import type { Epic, Story } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { EXAMPLE_STORIES } from "./example";
import { epicColorKey, type EpicColorKey } from "./palette";
import { normalizeQuarter, quarterIndex, quarterLabel, currentQuarterIndex } from "./quarters";
import {
  epicRollup,
  epicSchedule,
  linkedStories,
  type EpicRollup,
  type EpicSchedule,
} from "./rollup";

/** An epic with everything the page shows about it. */
export interface EpicView {
  epic: Epic;
  /** Its stories: the workspace's, or the example's read-only preview. */
  linked: Story[];
  rollup: EpicRollup;
  schedule: EpicSchedule;
  color: EpicColorKey;
}

export function epicViews(
  epics: readonly Epic[],
  stories: readonly Story[],
  now: Date = new Date()
): EpicView[] {
  return epics.map((epic, i) => {
    const linked = linkedStories(epic.id, isExampleId(epic.id) ? EXAMPLE_STORIES : stories);
    const rollup = epicRollup(epic, linked);
    return {
      epic,
      linked,
      rollup,
      schedule: epicSchedule(epic, rollup.pct, now),
      color: epicColorKey(epic, i),
    };
  });
}

/** Earliest start first, then earliest end; epics without valid quarters last. */
export function byStart(a: EpicView, b: EpicView): number {
  const key = (q: string) => quarterIndex(q) || Number.MAX_SAFE_INTEGER;
  return (
    key(a.epic.startQuarter) - key(b.epic.startQuarter) ||
    key(a.epic.endQuarter) - key(b.epic.endQuarter)
  );
}

/**
 * The quarters that show every epic: the earliest start to the latest end,
 * at least a year wide. This year when there are no dated epics.
 */
export function fitRange(
  epics: readonly Epic[],
  now: Date = new Date()
): { from: string; to: string } {
  let start = Infinity;
  let end = -Infinity;
  for (const e of epics) {
    const s = quarterIndex(e.startQuarter);
    const f = quarterIndex(e.endQuarter);
    if (s === 0 || f === 0 || f < s) continue;
    start = Math.min(start, s);
    end = Math.max(end, f);
  }
  if (!Number.isFinite(start)) {
    const year = now.getFullYear();
    return { from: `${year} Q1`, to: `${year} Q4` };
  }
  return { from: quarterLabel(start), to: quarterLabel(Math.max(end, start + 3)) };
}

/** Whether any of the epic's quarters fall inside `from`–`to`. */
export function inView(epic: Epic, from: string, to: string): boolean {
  const s = quarterIndex(epic.startQuarter);
  const e = quarterIndex(epic.endQuarter);
  const vs = quarterIndex(from);
  const ve = quarterIndex(to);
  return s !== 0 && e !== 0 && e >= s && e >= vs && s <= ve;
}

const named = (v: EpicView) => `“${v.epic.title}”`;

/**
 * The one sentence above the roadmap: what is late, else what ends this
 * quarter, else what finishes next. Progress is the rolled-up figure.
 */
export function roadmapVerdict(views: readonly EpicView[]): string {
  if (views.length === 0) return "No epics on the roadmap yet.";

  const overdue = views.filter((v) => v.schedule === "overdue");
  if (overdue.length === 1) {
    const [v] = overdue;
    return `${named(v)} is past its end quarter (${normalizeQuarter(v.epic.endQuarter)}) at ${v.rollup.pct}%.`;
  }
  if (overdue.length > 1) {
    return `${overdue.length} epics are past their end quarter and not done: ${listAnd(overdue.map(named))}.`;
  }

  const ending = views.filter((v) => v.schedule === "ending");
  if (ending.length === 1)
    return `${named(ending[0])} ends this quarter at ${ending[0].rollup.pct}%.`;
  if (ending.length > 1) {
    return `${ending.length} epics end this quarter: ${listAnd(
      ending.map((v) => `${named(v)} at ${v.rollup.pct}%`)
    )}.`;
  }

  const open = views.filter((v) => v.schedule !== "done");
  if (open.length === 0)
    return views.length === 1 ? "The epic is done." : `All ${views.length} epics are done.`;
  const dated = open
    .filter((v) => v.schedule !== "unscheduled")
    .sort((a, b) => quarterIndex(a.epic.endQuarter) - quarterIndex(b.epic.endQuarter));
  if (dated.length === 0)
    return `${plural(open.length, "epic")} still ${open.length === 1 ? "needs" : "need"} valid quarters.`;
  const next = dated[0];
  return `No epic is overdue; next to finish is ${named(next)} in ${normalizeQuarter(
    next.epic.endQuarter
  )}, at ${next.rollup.pct}%.`;
}

/** What the timeline shows, for its figure description. */
export function timelineSummary(
  views: readonly EpicView[],
  from: string,
  to: string,
  now: Date = new Date()
): string {
  const shown = views.filter((v) => inView(v.epic, from, to)).length;
  const nowIndex = currentQuarterIndex(now);
  const here =
    nowIndex >= quarterIndex(from) && nowIndex <= quarterIndex(to)
      ? ` This quarter is ${quarterLabel(nowIndex)}.`
      : "";
  return `${plural(shown, "epic")} from ${from} to ${to}.${here}`;
}
