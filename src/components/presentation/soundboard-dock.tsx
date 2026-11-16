"use client";

import { useEffect, useId, useState } from "react";
import { Music, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SoundboardButtons } from "@/components/soundboard/soundboard-buttons";
import { hydrateFacilitatorSettings, useFacilitatorSettings } from "@/lib/facilitator-timers/store";

/**
 * The soundboard while presenting, on any tool: a small button at the
 * right edge that opens the drumroll, gong, applause, ding and Amr's cheer
 * (components/soundboard). Only when the facilitator turned it on in
 * Facilitator Timers ("Show the soundboard while presenting"); off by
 * default. Present mode mounts it (presentation-mode.tsx). Sound only:
 * nothing is drawn over the page.
 */
export function SoundboardDock() {
  const on = useFacilitatorSettings((s) => s.soundboardWhilePresenting === true);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useEffect(() => hydrateFacilitatorSettings(), []);
  if (!on) return null;
  return (
    <div
      data-soundboard-dock
      className="fixed right-3 top-1/2 z-[95] flex -translate-y-1/2 flex-col items-end gap-2"
    >
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close the soundboard" : "Open the soundboard"}
        title="Soundboard"
        onClick={() => setOpen((v) => !v)}
        className="bg-card/90 backdrop-blur"
      >
        {open ? <X aria-hidden="true" /> : <Music aria-hidden="true" />}
      </Button>
      {open && (
        <div
          id={panelId}
          className="rounded-lg border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur"
        >
          <SoundboardButtons compact className="flex-col" />
        </div>
      )}
    </div>
  );
}
