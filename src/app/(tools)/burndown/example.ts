import { exampleId } from "@/components/tool-frame/example-data";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { BurndownConfig, DayEntry } from "./markdown";

const DAYS_IN = 6;

/** Remaining points at the end of each logged day, with the day's note. */
const LOG: [remaining: number, note?: string, scopeChange?: true][] = [
  [40],
  [38],
  [33, "Fixed the flaky login test"],
  [30],
  [36, "Pulled in the card-declined fix for the holiday sale (+8 pts)", true],
  [31],
  [26, "Saved cards done"],
];

/**
 * A mobile checkout team six days into a two-week sprint: 40 points over 10
 * working days, started six days ago so today's marker lands on day 6. A fix
 * pulled in on day 4 adds 8 points, which is most of why the team sits
 * 10 points behind the ideal line. Days 7 to 10 are still blank.
 */
export function buildExample(now: Date = new Date()): {
  config: BurndownConfig;
  entries: DayEntry[];
} {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_IN);
  const config: BurndownConfig = {
    totalPoints: 40,
    sprintDays: 10,
    sprintStartDate: todayLocalISO(start),
  };
  const entries = Array.from({ length: config.sprintDays + 1 }, (_, day): DayEntry => {
    const [remaining, description, scopeChange] = LOG[day] ?? [];
    return {
      id: exampleId(`day-${day}`),
      day,
      remaining: remaining ?? null,
      scopeChange: scopeChange ?? false,
      ...(description ? { description } : {}),
    };
  });
  return { config, entries };
}
