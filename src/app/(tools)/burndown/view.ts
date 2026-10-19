/**
 * The burndown's view of a shared sprint: the sprint and its daily log in the
 * `{config, entries}` shape the chart, the Markdown export and the AI prompts
 * have always taken.
 *
 * - `config.totalPoints` is the sprint's planned points, `sprintDays` its
 *   length (day 0 is the start date, the ideal line reaches 0 on the end
 *   date), `sprintStartDate` its start date.
 * - Each entry's `remaining` is what Burndown typed, else what Burnup's
 *   points done work out to, else (day 0 only) the scope the sprint started
 *   with. `typed`, `derived` and `source` say which, so the table can show a
 *   worked-out number dimmed instead of as if it were typed.
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { dayEntry, remainingAt, scopeAt, sprintLengthDays } from "@/lib/sprints/series";
import type { BurndownConfig, DayEntry } from "./markdown";

export type ValueSource = "typed" | "derived" | "plan";

export interface BurndownRow extends DayEntry {
  /** Remaining as typed in Burndown, or null. */
  typed: number | null;
  /** Remaining worked out from Burnup's points done (shown dimmed), or null. */
  derived: number | null;
  /** Where `remaining` comes from; null for a blank day. */
  source: ValueSource | null;
  /** Anything stored for this day, by either tool (it can be cleared). */
  stored: boolean;
  /** A day past the sprint's end (logged before the sprint was shortened). */
  afterEnd: boolean;
}

export interface BurndownView {
  config: BurndownConfig;
  entries: BurndownRow[];
  /** Days flagged as a scope change, or where the stored scope moved. */
  scopeChangeDays: number[];
}

/** Days 0 to the sprint's end, plus any later day with something stored. */
export function viewDays(series: SprintSeries | undefined, lengthDays: number): number[] {
  const days = Array.from({ length: lengthDays + 1 }, (_, i) => i);
  const later = new Set<number>();
  for (const d of series?.days ?? []) {
    if (Number.isInteger(d.day) && d.day > lengthDays) later.add(d.day);
  }
  return later.size === 0 ? days : days.concat(Array.from(later).sort((a, b) => a - b));
}

export function burndownView(sprint: Sprint, series: SprintSeries | undefined): BurndownView {
  const sprintDays = sprintLengthDays(sprint);
  const config: BurndownConfig = {
    totalPoints: sprint.pointsPlanned,
    sprintDays,
    sprintStartDate: sprint.startDate.slice(0, 10),
  };

  const scopeDays = new Set<number>();
  const entries = viewDays(series, sprintDays).map((day): BurndownRow => {
    const stored = dayEntry(series, day);
    const typed = stored?.remaining ?? null;
    const derived = typed === null ? remainingAt(sprint, series, day) : null;
    const plan =
      day === 0 && typed === null && derived === null ? scopeAt(sprint, series, 0) : null;
    const remaining = typed ?? derived ?? plan;
    if (stored?.scopeChange) scopeDays.add(day);
    if (day > 0 && stored?.scope != null && stored.scope !== scopeAt(sprint, series, day - 1)) {
      scopeDays.add(day);
    }
    return {
      id: `${sprint.id}:day-${day}`,
      day,
      remaining,
      scopeChange: Boolean(stored?.scopeChange),
      ...(stored?.note ? { description: stored.note } : {}),
      typed,
      derived,
      source:
        typed !== null ? "typed" : derived !== null ? "derived" : plan !== null ? "plan" : null,
      stored: Boolean(stored),
      afterEnd: day > sprintDays,
    };
  });

  return {
    config,
    entries,
    scopeChangeDays: Array.from(scopeDays)
      .filter((d) => d <= sprintDays)
      .sort((a, b) => a - b),
  };
}
