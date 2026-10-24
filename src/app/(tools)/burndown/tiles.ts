/**
 * Burndown's four tiles from the burn: what's left, the pace against the
 * ideal line, what's done of the current scope, and where the trend
 * finishes. Every number is lib/sprints/burn's (gap, completionPct,
 * projectFinish on the team's working days), so the tiles, the verdict, the
 * Markdown and tool.burndown.status agree. A number that can't be read
 * yet says so instead of showing 0. Pure.
 */

import type { BurnSeries, BurnStatus } from "@/lib/sprints/burn";
import { fmt } from "@/lib/sprints/hub-view";
import { dayDate } from "@/lib/sprints/series";
import type { Sprint } from "@/lib/stores/workspace-types";

export interface BurnTile {
  id: string;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone: "default" | "success" | "warning" | "danger";
  /** No number yet: the value is a message, shown muted. */
  empty?: boolean;
}

/** "16 Oct" in the reader's locale, for a hint. */
function shortDay(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** "from the board", "from the typed log": which source a number came from. */
export function fromWhere(burn: Pick<BurnSeries, "source">): string {
  return burn.source === "stories" ? "from the board" : "from the typed log";
}

const CANT_TELL = "Open stories have no points";

/** The projected-finish tile for a projected calendar day (Burnup's meet day too). */
export function projectionTile(
  id: string,
  label: string,
  sprint: Sprint,
  burn: BurnSeries,
  day: number | null,
  onTime: boolean | null,
  cantTell: boolean,
  noTrend: string
): BurnTile {
  if (cantTell) {
    return { id, label, value: "Can't tell yet", hint: CANT_TELL, tone: "default", empty: true };
  }
  if (day === null) {
    return {
      id,
      label,
      value: "No trend yet",
      hint:
        burn.lastDay === null || burn.lastDay < 1 ? "Needs a second day with a number" : noTrend,
      tone: "default",
      empty: true,
    };
  }
  const d = Math.ceil(day);
  const date = shortDay(dayDate(sprint, d));
  return {
    id,
    label,
    value: `Day ${d}`,
    hint: `${date ? `${date} · ` : ""}${
      onTime === false
        ? `after the last day (day ${burn.lengthDays})`
        : `last day is day ${burn.lengthDays}`
    }`,
    tone: onTime === false ? "warning" : "default",
  };
}

export function burndownTiles(sprint: Sprint, burn: BurnSeries, status: BurnStatus): BurnTile[] {
  const n = burn.unpointedOpen;
  const unpointed = n > 0 ? ` · ${n} ${n === 1 ? "story" : "stories"} without points` : "";
  const remaining: BurnTile =
    burn.remaining === null || burn.lastDay === null
      ? {
          id: "remaining",
          label: "Remaining",
          value: "Not logged yet",
          tone: "default",
          empty: true,
        }
      : {
          id: "remaining",
          label: "Remaining",
          value: fmt(burn.remaining),
          unit: "points",
          hint: `On day ${burn.lastDay} · ${fromWhere(burn)}${unpointed}`,
          tone: "default",
        };
  const gap: BurnTile = status.cantTell
    ? {
        id: "gap",
        label: "Pace vs ideal",
        value: "Can't tell yet",
        hint: CANT_TELL,
        tone: "default",
        empty: true,
      }
    : status.gap === null || status.gapLabel === null
      ? { id: "gap", label: "Pace vs ideal", value: "—", tone: "default", empty: true }
      : {
          id: "gap",
          label: "Pace vs ideal",
          value: status.gapLabel,
          hint: `Ideal: ${fmt(status.idealRemaining ?? 0)} left on day ${burn.lastDay}`,
          tone: status.gap > 0 ? "warning" : n > 0 ? "default" : "success",
        };
  const done: BurnTile =
    burn.done === null
      ? { id: "done", label: "Done", value: "—", tone: "default", empty: true }
      : {
          id: "done",
          label: "Done",
          value: fmt(burn.done),
          unit: `of ${fmt(burn.scopeNow)} points`,
          hint:
            status.completionPct === null
              ? "No scope yet"
              : `${status.completionPct}% of the current scope`,
          tone: "default",
        };
  return [
    remaining,
    gap,
    done,
    projectionTile(
      "finish",
      "Projected finish",
      sprint,
      burn,
      status.projectedFinishDay,
      status.willFinishOnTime,
      status.cantTell,
      "The points left aren't going down"
    ),
  ];
}
