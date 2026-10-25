/**
 * Fixtures for the lib/flow tests. Stamps are built from LOCAL times
 * (`local("2026-10-20", 23, 30)`), so a test reads the same in any time
 * zone: the local day of the stamp is always the day given, while its UTC
 * date (what `iso.slice(0, 10)` would read) moves with the zone.
 */

import type { KanbanCard, Sprint, Story } from "@/lib/stores/workspace-types";

/** The UTC ISO stamp of a local time on `day` ("YYYY-MM-DD"). */
export function local(day: string, hour = 12, minute = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

/** The local "YYYY-MM-DD" of a stamp, worked out independently of lib code. */
export function localYmd(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const sprint = (patch: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 10,
  status: "active",
  ...patch,
});

export const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "todo",
  sprintId: "s1",
  ...patch,
});

export const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: `Card ${id}`,
  column: "backlog",
  class: "standard",
  createdAt: local("2026-10-01", 9),
  ...patch,
});
