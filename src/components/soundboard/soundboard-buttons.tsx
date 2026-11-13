"use client";

import { Bell, Disc3, Drum, Hand, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cheer } from "@/lib/celebrate/cheer";
import { cn } from "@/lib/utils";
import {
  SOUNDBOARD_LABEL,
  SOUNDBOARD_SOUNDS,
  playSoundboard,
  type SoundboardSound,
} from "@/lib/facilitator-timers/sounds";

/** The tool the soundboard belongs to: Amr's cheer is announced as its moment. */
export const SOUNDBOARD_TOOL = "facilitator-timers";

const ICON: Record<SoundboardSound, LucideIcon> = {
  drumroll: Drum,
  gong: Disc3,
  applause: Hand,
  ding: Bell,
};

/** What a press played, for the caller's own status line. */
export type SoundboardPress = SoundboardSound | "cheer";

/**
 * The soundboard: a drumroll, a gong, applause and a ding, all made in the
 * browser (lib/facilitator-timers/sounds), and a cheer from Amr (his own
 * reaction, with his sound when the visitor's sound settings allow it).
 * Sound only: nothing is drawn over the page.
 */
export function SoundboardButtons({
  onPlayed,
  compact = false,
  className,
}: {
  onPlayed?: (press: SoundboardPress) => void;
  /** Icon buttons (the presenting dock) instead of labelled ones. */
  compact?: boolean;
  className?: string;
}) {
  const press = (sound: SoundboardSound) => {
    playSoundboard(sound);
    onPlayed?.(sound);
  };
  const amr = () => {
    cheer(SOUNDBOARD_TOOL, "result", { sound: true });
    onPlayed?.("cheer");
  };
  const size = compact ? "icon" : "sm";
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Soundboard">
      {SOUNDBOARD_SOUNDS.map((sound) => {
        const Icon = ICON[sound];
        return (
          <Button
            key={sound}
            type="button"
            variant="outline"
            size={size}
            className={compact ? undefined : "gap-1.5"}
            onClick={() => press(sound)}
            aria-label={compact ? `Play ${SOUNDBOARD_LABEL[sound].toLowerCase()}` : undefined}
            title={compact ? SOUNDBOARD_LABEL[sound] : undefined}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {!compact && SOUNDBOARD_LABEL[sound]}
          </Button>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size={size}
        className={compact ? undefined : "gap-1.5"}
        onClick={amr}
        aria-label={compact ? "Ask Amr to cheer" : undefined}
        title={compact ? "Amr cheer" : undefined}
      >
        <Smile className="h-4 w-4" aria-hidden="true" />
        {!compact && "Amr cheer"}
      </Button>
    </div>
  );
}
