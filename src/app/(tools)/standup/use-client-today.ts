"use client";

import { useSyncExternalStore } from "react";
import { todayLocalISO } from "@/lib/utils/formatters";

/** Asks again every minute, so "today" rolls over at midnight without a reload. */
function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(id);
}

const noDay = () => "";

/**
 * Today (local YYYY-MM-DD) as the browser sees it, following the clock past
 * midnight. "" in the prerendered page and while it hydrates: the static
 * HTML is built once, so a day computed then is the build's day, and
 * hydrating on any later day would find other text (React #418/#425).
 * The real day arrives in the render right after.
 */
export function useClientToday(): string {
  return useSyncExternalStore(subscribe, todayLocalISO, noDay);
}
