"use client";

import type { DesignSprintDay, DesignSprintDayNumber } from "@/lib/stores/workspace-types";
import type { DesignSprintToday } from "@/lib/design-sprint/day";
import { DESIGN_SPRINT_DAY_NAMES } from "@/lib/design-sprint/plan";
import { cn } from "@/lib/utils";
import { dayTasks, shortDay } from "./doc";

/** The sprint day that falls on `todayIso`; null before, after, and on a day off. */
export function dayOnDate(t: DesignSprintToday, todayIso: string): DesignSprintDayNumber | null {
  return t.status === "running" && t.day && t.dates[t.day - 1] === todayIso ? t.day : null;
}

/**
 * The five days with their dates. Today's day is marked; selecting a day
 * only opens it on the page, it never moves the sprint on (the day is
 * worked out from the start date). On a phone the row scrolls sideways
 * inside its own container.
 */
export function DayTimeline({
  days,
  today,
  todayIso,
  viewed,
  onView,
}: {
  days: readonly DesignSprintDay[];
  today: DesignSprintToday;
  /** "YYYY-MM-DD": a weekend in the middle of the sprint marks no day as today. */
  todayIso: string;
  viewed: DesignSprintDayNumber;
  onView: (day: DesignSprintDayNumber) => void;
}) {
  const todays = dayOnDate(today, todayIso);
  return (
    <div role="group" aria-label="Sprint days" className="scroll-x-snap mb-6 items-stretch pb-2">
      {days.map((d, i) => {
        const tasks = dayTasks(d);
        const pct =
          tasks.length === 0
            ? 0
            : Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
        const isViewed = viewed === d.day;
        const isToday = todays === d.day;
        const date = shortDay(today.dates[i]);
        return (
          <button
            key={d.day}
            type="button"
            onClick={() => onView(d.day)}
            aria-pressed={isViewed}
            aria-current={isToday ? "date" : undefined}
            className={cn(
              "min-w-[132px] rounded-lg border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:flex-1",
              isViewed
                ? "border-accent/60 bg-accent/10"
                : "border-border bg-surface hover:border-accent/30"
            )}
          >
            <span className="flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-sub">
              Day {d.day}
              {isToday && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-xs normal-case tracking-normal text-accent">
                  Today
                </span>
              )}
            </span>
            <span className="block text-sm font-semibold text-text">
              {DESIGN_SPRINT_DAY_NAMES[d.day]}
            </span>
            {date && <span className="block text-xs text-sub">{date}</span>}
            <span className="block font-data text-xs text-sub">{pct}% done</span>
          </button>
        );
      })}
    </div>
  );
}
