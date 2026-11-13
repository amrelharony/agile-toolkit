"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAlarmPrefs } from "@/lib/celebrate/alarm-prefs";
import { cn } from "@/lib/utils";

/**
 * "Chime when time is up": the shared switch for the timers that ring
 * `timesUp` (room countdowns, the Retro board's timer, the step timer, the
 * docked timer). Off by default; kept in this browser.
 */
export function ChimeToggle({ className }: { className?: string }) {
  const id = useId();
  const sound = useAlarmPrefs((s) => s.sound);
  const setSound = useAlarmPrefs((s) => s.setSound);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Switch id={id} checked={sound} onCheckedChange={setSound} />
      <Label htmlFor={id} className="text-sm text-sub">
        Chime when time is up
      </Label>
    </div>
  );
}
