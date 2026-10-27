/**
 * The OKR progress formula lives in lib/okrs/progress, shared with Sprint
 * Goal, the agent actions, the AI prompt and the Canvas import. These names
 * stay for the page's imports; `objectiveHealth` is `objectiveProgress`.
 *
 * `progressTrend` is the page's own until lib/okrs has a progress-over-time
 * reader beside confidenceTrend (asked of the main session, for
 * tool.okrs.list_state too). It computes no progress itself: each day's
 * value is lib/okrs krProgress on the key result as it read that day.
 */
import type { KeyResultCheckIn, Okr } from "@/lib/stores/workspace-types";
import { krProgress } from "@/lib/okrs/progress";
import { isIsoDate } from "@/lib/sprints/calendar";

export { krProgress, objectiveProgress as objectiveHealth } from "@/lib/okrs/progress";

export interface ProgressPoint {
  /** "YYYY-MM-DD": a day a key result was checked in. */
  date: string;
  /** The objective's progress that day, whole %: the mean of its key results' (krProgress). */
  pct: number;
  /** How many key results had a check-in by then. */
  checkedIn: number;
}

/** A check-in a reader can place: a real "YYYY-MM-DD" day and a finite value (as lib/okrs reads them). */
const readable = (c: KeyResultCheckIn) =>
  typeof c.date === "string" &&
  c.date.length === 10 &&
  isIsoDate(c.date) &&
  typeof c.value === "number" &&
  Number.isFinite(c.value);

/**
 * An objective's progress over time, oldest first: one point per day a key
 * result was checked in, each the mean of every key result's progress as
 * of that day (krProgress on its latest check-in's value by then). It needs
 * no confidence, so a team that checks in values without scoring them
 * still sees how far the objective moved. A key result with no dated
 * check-in has no day its value changed, so its current value counts on
 * every day (as confidenceTrend counts an undated score); one whose
 * check-ins all come later counts as where it starts (0%) until its first.
 * While current mirrors the newest check-in (lib/okrs withCheckIn), the
 * last point is objectivePercent.
 */
export function progressTrend(okr: Pick<Okr, "keyResults">): ProgressPoint[] {
  const perKr = (okr.keyResults ?? []).map((kr) => ({
    kr,
    // A stable sort: same-day check-ins keep their order, so the last is the one current mirrors.
    dated: (kr.checkIns ?? [])
      .filter(readable)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }));
  const days = Array.from(new Set(perKr.flatMap((k) => k.dated.map((c) => c.date)))).sort();
  return days.map((day) => {
    let sum = 0;
    let checkedIn = 0;
    for (const { kr, dated } of perKr) {
      if (dated.length === 0) {
        sum += krProgress(kr);
        continue;
      }
      let value: number | undefined;
      for (const c of dated) {
        if (c.date > day) break;
        value = c.value;
      }
      if (value === undefined) continue;
      checkedIn += 1;
      sum += krProgress({ ...kr, current: value });
    }
    return { date: day, pct: Math.round((sum / perKr.length) * 100), checkedIn };
  });
}
