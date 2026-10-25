import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt, plural } from "@/lib/charts/chart-text";
import type { CfdMetrics, CfdView } from "./view";
import { dayTotals } from "./view";

/** How far back the verdict looks for a widening band or a stall. */
export const VERDICT_WINDOW = 8;
/** A band that grew by this many items over the window is widening. */
export const WIDENING_GROWTH = 2;
/** Days in a row with nothing finished, WIP above 0, before it's a stall. */
export const STALL_DAYS = 3;

/** "stories", "cards" or "items", for the source. */
export function itemNoun(view: Pick<CfdView, "source">, n = 2): string {
  const [one, many] =
    view.source === "sprint"
      ? ["story", "stories"]
      : view.source === "flow"
        ? ["card", "cards"]
        : ["item", "items"];
  return n === 1 ? one : many;
}

/** What to finish first when a stage's band widens. */
function finishWhat(stageId: string, label: string): string {
  return stageId === "review" || /review/i.test(label) ? "reviews" : "what's in progress";
}

const pointName = (view: Pick<CfdView, "source">, n: number) =>
  view.source === "typed" ? plural(n, "snapshot") : plural(n, "day");

/**
 * The one-sentence answer above the chart, in order of what needs acting
 * on: a stage whose band is widening (work piling up there), a stall (WIP
 * but nothing finished for days), else steady flow with its throughput
 * and Little's Law lead time. With too few points it says so.
 *
 *   "Review grew from 2 to 6 stories over 8 days while 3 were finished: finish reviews before starting more."
 */
export function cfdVerdict(view: CfdView, metrics: CfdMetrics): string {
  const { days, workflow } = view;
  if (view.source !== "typed" && view.itemCount === 0) {
    return view.source === "sprint"
      ? "No stories on this sprint's board yet."
      : "No cards on the Flow board yet.";
  }
  if (days.length === 0) {
    return view.source === "typed"
      ? "No snapshots yet."
      : "The chart starts on the sprint's first day.";
  }
  if (!metrics.enough) {
    return `Only ${pointName(view, days.length)} so far: throughput and lead time show from ${pointName(
      view,
      MIN_SAMPLE.average
    )}.`;
  }

  const window = days.slice(-VERDICT_WINDOW);
  const first = window[0];
  const last = window[window.length - 1];
  const span = window.length;
  const doneFirst = dayTotals(first, workflow).done;
  const doneLast = dayTotals(last, workflow).done;
  const finished = Math.max(0, doneLast - doneFirst);

  // (a) The active stage whose band grew most over the window.
  let widest: { id: string; label: string; from: number; to: number } | null = null;
  for (const stage of workflow.stages) {
    if (stage.kind !== "active") continue;
    const from = first.counts[stage.id] ?? 0;
    const to = last.counts[stage.id] ?? 0;
    if (to - from >= WIDENING_GROWTH && (!widest || to - from > widest.to - widest.from)) {
      widest = { id: stage.id, label: stage.label, from, to };
    }
  }
  if (widest) {
    const over =
      view.source === "typed" ? `over ${pointName(view, span)}` : `over ${plural(span, "day")}`;
    return `${widest.label} grew from ${widest.from} to ${widest.to} ${itemNoun(view)} ${over} while ${finished} ${
      finished === 1 ? "was" : "were"
    } finished: finish ${finishWhat(widest.id, widest.label)} before starting more.`;
  }

  // (b) WIP, but nothing finished for the last few points.
  const wip = metrics.latest?.wip ?? 0;
  const tail = days.slice(-(STALL_DAYS + 1));
  if (wip > 0 && tail.length > STALL_DAYS) {
    const flat =
      dayTotals(tail[tail.length - 1], workflow).done <= dayTotals(tail[0], workflow).done;
    if (flat) {
      return `Nothing was finished in the last ${pointName(view, STALL_DAYS)} while ${wip} ${itemNoun(
        view,
        wip
      )} ${wip === 1 ? "is" : "are"} in progress: swarm on the oldest before starting more.`;
    }
  }

  // (c) Steady flow.
  if (metrics.littles) {
    const { throughputPerDay, leadTimeDays } = metrics.littles;
    return `About ${fmt(throughputPerDay, 2)} ${itemNoun(view)} finished a day; at that pace an item takes ≈ ${fmt(
      leadTimeDays
    )} days from start to done (Little's Law).`;
  }
  if (metrics.throughputPerDay !== null && metrics.throughputPerDay > 0) {
    return `About ${fmt(metrics.throughputPerDay, 2)} ${itemNoun(view)} finished a day.`;
  }
  return `Nothing finished in these ${pointName(view, days.length)} yet, so there's no throughput to read.`;
}
