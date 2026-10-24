"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `everyMs` (default hourly) so day-based
 * numbers move on while a tab stays open.
 *
 * BUG-RD3-kanban-3: "finished in the last 7 days" read `Date.now()` inside a
 * memo keyed only on the cards, so a tab left open past midnight kept the
 * cutoff frozen at the last edit. Ages in a column have the same problem;
 * an hourly tick is plenty for day-sized numbers.
 */
export function useNow(everyMs = 60 * 60 * 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
