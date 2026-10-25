/**
 * Burnup's four tiles from the burn: done against the current scope, the
 * scope added and removed since day 0, and the day the work meets the scope
 * at this pace. Every number is lib/sprints/burn's, so the tiles, the
 * verdict, the Markdown and tool.burnup.status agree; nothing reads 0
 * before there is something to count. Pure.
 */

import type { BurnSeries, BurnStatus } from "@/lib/sprints/burn";
import { fmt } from "@/lib/sprints/hub-view";
import type { Sprint } from "@/lib/stores/workspace-types";
import { fromWhere, notYet, projectionTile, type BurnTile } from "../burndown/tiles";

/** "days 3 and 5", the days some scope moved. */
function daysOf(days: number[]): string {
  if (days.length === 0) return "";
  if (days.length === 1) return `day ${days[0]}`;
  return `days ${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
}

export function burnupTiles(sprint: Sprint, burn: BurnSeries, status: BurnStatus): BurnTile[] {
  const read = burn.lastDay !== null && burn.done !== null;
  const upTo = (d: { day: number }) => burn.lastDay !== null && d.day <= burn.lastDay;
  const addedDays = burn.days.filter((d) => d.added > 0 && upTo(d)).map((d) => d.day);
  const removedDays = burn.days.filter((d) => d.removed > 0 && upTo(d)).map((d) => d.day);
  const n = burn.unpointedOpen;
  const done: BurnTile = !read
    ? { id: "done", label: "Done", value: notYet(burn), tone: "default", empty: true }
    : {
        id: "done",
        label: "Done",
        value: fmt(burn.done as number),
        unit: `of ${fmt(burn.scopeNow)} points`,
        hint: `${status.completionPct === null ? "No scope yet" : `${status.completionPct}% of the current scope`} · ${fromWhere(burn)}${
          n > 0 ? ` · ${n} ${n === 1 ? "story" : "stories"} without points` : ""
        }`,
        tone: "default",
      };
  const added: BurnTile = !read
    ? { id: "added", label: "Scope added", value: "—", tone: "default", empty: true }
    : {
        id: "added",
        label: "Scope added",
        value: burn.scopeAdded > 0 ? `+${fmt(burn.scopeAdded)}` : "0",
        unit: "points",
        hint: burn.scopeAdded > 0 ? `On ${daysOf(addedDays)}` : "Nothing added since day 0",
        tone: burn.scopeAdded > 0 ? "warning" : "default",
      };
  const removed: BurnTile = !read
    ? { id: "removed", label: "Scope removed", value: "—", tone: "default", empty: true }
    : {
        id: "removed",
        label: "Scope removed",
        value: burn.scopeRemoved > 0 ? `−${fmt(burn.scopeRemoved)}` : "0",
        unit: "points",
        hint: burn.scopeRemoved > 0 ? `On ${daysOf(removedDays)}` : "Nothing removed since day 0",
        tone: "default",
      };
  return [
    done,
    added,
    removed,
    projectionTile(
      "meet",
      "Projected done",
      sprint,
      burn,
      status.projectedMeetDay,
      status.willMeetOnTime,
      status.cantTell,
      "The points done aren't climbing"
    ),
  ];
}
