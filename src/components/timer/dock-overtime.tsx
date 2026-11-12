"use client";

import { useEffect, useState } from "react";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { overtimeText } from "@/lib/celebrate/chime";
import { dockOvertime, type DockedTimer } from "@/lib/timer/dock-timer";

/**
 * The overtime of a docked timer that ran out ("+1:05 over"), counting up
 * every second, for the owner page's own clock beside its "Time's up". The
 * docked timer marks when it reached zero (`expire`); before then, and for a
 * timer nobody saw end, this shows nothing.
 */
export function DockOvertime({ timer, className }: { timer: DockedTimer; className?: string }) {
  const counting = timer.endsAt === null && typeof timer.endedAt === "number";
  const [now, setNow] = useState(() => Date.now());
  useVisibilityTick(counting, 1000, () => setNow(Date.now()));
  // The moment it runs out shows at once, not on the next tick.
  useEffect(() => setNow(Date.now()), [timer.endedAt]);
  if (!counting) return null;
  return <span className={className}>{overtimeText(dockOvertime(timer, now))}</span>;
}
