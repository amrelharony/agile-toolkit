"use client";

import { useEffect, useRef, useState } from "react";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Today (local YYYY-MM-DD), following the clock past midnight, so a page
 * left open overnight doesn't keep dating new checks, rounds and check-ins
 * yesterday. Shared by the Health Check, Psych Safety and Mood Tracker
 * pages.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayLocalISO());
  useEffect(() => {
    const t = window.setInterval(() => {
      const next = todayLocalISO();
      setToday((cur) => (cur === next ? cur : next));
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

/**
 * A day someone can pick, starting on `today`: while it still is the day
 * that was today, it moves on with the clock; a day picked by hand stays.
 */
export function useDayPick(today: string): [string, (day: string) => void] {
  const [day, setDay] = useState(today);
  const was = useRef(today);
  useEffect(() => {
    const before = was.current;
    was.current = today;
    if (before !== today) setDay((d) => (d === before ? today : d));
  }, [today]);
  return [day, setDay];
}
