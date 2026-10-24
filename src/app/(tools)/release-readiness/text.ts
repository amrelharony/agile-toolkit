/**
 * Release Readiness: the small wording helpers the cards, the verdict, the
 * charts and the export share. Pure.
 */

import type { Release } from "@/lib/stores/workspace-types";
import { NO_VALUE, plural } from "@/lib/charts/chart-text";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";

/** "24 Oct" (or "24 Oct 2026"), or "—" for no day. */
export function dayLabel(value: string | undefined | null, withYear = false): string {
  const day = value ? value.slice(0, 10) : "";
  if (!isIsoDate(day)) return NO_VALUE;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** Whole days from `from` to `to`, or null when either isn't a day. */
export function daysBetween(from: string | undefined, to: string | undefined): number | null {
  const a = isoDayNumber(from?.slice(0, 10));
  const b = isoDayNumber(to?.slice(0, 10));
  return a === null || b === null ? null : b - a;
}

/** "planned for today", "planned in 3 days", "planned 2 days ago". */
export function plannedWhen(plannedDate: string, today: string): string {
  const d = daysBetween(today, plannedDate);
  if (d === null) return "with no planned date";
  if (d === 0) return "planned for today";
  if (d > 0) return `planned in ${plural(d, "day")}`;
  return `planned ${plural(-d, "day")} ago`;
}

/** "on time", "a day early", "3 days late", for a ship against its plan. */
export function shipTiming(shippedDate: string | undefined, plannedDate: string): string {
  const d = daysBetween(plannedDate, shippedDate);
  if (d === null) return "";
  if (d === 0) return "on time";
  if (d < 0) return d === -1 ? "a day early" : `${-d} days early`;
  return d === 1 ? "a day late" : `${d} days late`;
}

/** The release's name, or a stand-in for one an agent saved blank. */
export const nameOf = (r: Pick<Release, "name">) =>
  (typeof r.name === "string" && r.name.trim()) || "Unnamed release";

export const STATUS_LABEL: Record<Release["status"], string> = {
  planning: "Planning",
  shipped: "Shipped",
  rolled_back: "Rolled back",
};
