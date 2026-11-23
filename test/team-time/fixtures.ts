/**
 * Team Time people for the lib tests, in zones with long-stable rules only,
 * and the week of Monday 16 November 2026 (London on UTC, New York five
 * hours behind, Tokyo nine ahead).
 */

import type { TeamTimePerson } from "@/lib/stores/workspace-types";

export const AT = "2026-11-16T00:00:00.000Z";
export const MON_FRI = [1, 2, 3, 4, 5];

export const person = (over: Partial<TeamTimePerson> & { id: string }): TeamTimePerson => ({
  name: over.id,
  timeZone: "UTC",
  start: "09:00",
  end: "17:00",
  workingDays: MON_FRI,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

/** 09:00–17:30 UTC in winter. */
export const london = person({
  id: "london",
  name: "Lou",
  timeZone: "Europe/London",
  start: "09:00",
  end: "17:30",
});
/** 14:00–22:00 UTC in winter. */
export const newYork = person({
  id: "ny",
  name: "Noor",
  timeZone: "America/New_York",
  start: "09:00",
  end: "17:00",
});
/** 00:00–09:00 UTC. */
export const tokyo = person({
  id: "tokyo",
  name: "Taro",
  timeZone: "Asia/Tokyo",
  start: "09:00",
  end: "18:00",
});

export const t = (s: string) => Date.parse(s);
