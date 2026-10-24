import { SAY_DO_GRADE_LABEL, gap as gapOf, gapLabel, sayDoRatio } from "@/lib/sprints/metrics";
import { fmt, points } from "@/lib/sprints/hub-view";
import { dayForDate, hasSyntheticDates, idealRemainingAt } from "@/lib/sprints/series";
import { idealBase, noPointsLine, type CockpitData } from "./view";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Behind by 3 points" → "behind by 3 points", for the middle of a sentence. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** " (not counting 1 story without points)": the board's numbers leave them out. */
const notCounting = (n: number) =>
  n > 0 ? ` (not counting ${plural(n, "story", "stories")} without points)` : "";

type VerdictData = Pick<
  CockpitData,
  "sprint" | "status" | "progress" | "burndown" | "openImpediments" | "blockedStories"
>;

/**
 * The one sentence over the cockpit: where the sprint stands today, from
 * the same numbers as the tiles (the board's when it has pointed stories),
 * and what is in the way. An ended sprint that is still open says what to
 * do next: close it. A closed one says what was confirmed when it closed:
 * closing can move its unfinished stories off its board.
 */
export function cockpitVerdict(data: VerdictData, today: string): string {
  const { sprint, progress, burndown, status } = data;
  const name = sprint.name.trim() || "This sprint";
  const board = burndown.source === "stories";
  const unpointed = burndown.unpointedOpen;
  const blockers = data.openImpediments.length + data.blockedStories.length;
  const inTheWay =
    blockers === 0
      ? "nothing is blocking the team"
      : `${plural(blockers, "blocker")} ${blockers === 1 ? "is" : "are"} open`;

  if (sprint.status === "cancelled") return `${name} was cancelled.`;
  if (sprint.status === "completed") {
    const done = sprint.pointsCompleted;
    if (typeof done !== "number") {
      return `${name} is closed, but its completed points aren't recorded yet.`;
    }
    const committed = sprint.pointsPlanned;
    if (!(committed > 0)) return `${name} is closed with ${points(done)} done.`;
    const sayDo = sayDoRatio(committed, done);
    return `${name} is closed: ${fmt(done)} of ${points(committed)} done${
      sayDo ? ` (${sayDo.pct}%, ${lower(SAY_DO_GRADE_LABEL[sayDo.grade])})` : ""
    }.`;
  }

  const left = burndown.remaining.remaining;
  const day = hasSyntheticDates(sprint) ? null : dayForDate(sprint, today);
  if (day === null) {
    return left === null
      ? `${name} has no dates yet, so its pace can't be read.`
      : `${name} has ${points(left)} left${notCounting(unpointed)}, and ${inTheWay}.`;
  }
  if (day < 0) {
    const planned = board ? progress.scope : sprint.pointsPlanned;
    return `${name} starts in ${plural(-day, "day")} with ${points(planned)} planned.`;
  }
  const length = burndown.length;
  if (day > length) {
    // An open story without points leaves nothing "left" on the board, yet isn't done.
    const open = board ? progress.count - progress.doneCount : 0;
    if (left === 0 && open === 0) {
      return `${name} ended with everything done: close it to record its velocity.`;
    }
    const rest =
      left === null
        ? ""
        : left > 0
          ? ` with ${points(left)} left${notCounting(unpointed)}`
          : ` with ${plural(open, "unfinished story", "unfinished stories")}`;
    return `${name} ended ${plural(day - length, "day")} ago${rest}: close it and decide where the unfinished stories go.`;
  }

  const lead = `Day ${day} of ${length}`;
  if (board) {
    if (progress.remaining <= 0) {
      return unpointed > 0
        ? `${lead}: every pointed story is done, but ${noPointsLine(unpointed)} yet, and ${inTheWay}.`
        : `${lead}: every pointed story is done, and ${inTheWay}.`;
    }
    const ideal = idealRemainingAt(sprint, idealBase(sprint, progress), day);
    const pace = lower(gapLabel(gapOf(progress.remaining, ideal)));
    return `${lead}: ${fmt(progress.done)} of ${points(progress.scope)} done, ${pace}${notCounting(
      unpointed
    )}, and ${inTheWay}.`;
  }
  if (status.done === null || status.gap === null) {
    return `${lead}: no progress recorded yet (move stories on the sprint board or log the points left), and ${inTheWay}.`;
  }
  return `${lead}: ${fmt(status.done)} of ${points(status.scopeNow)} done, ${lower(
    gapLabel(status.gap)
  )}, and ${inTheWay}.`;
}
