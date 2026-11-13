"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Headphones, Music, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SectionCard } from "@/components/shared/section-card";
import {
  SoundboardButtons,
  type SoundboardPress,
} from "@/components/soundboard/soundboard-buttons";
import {
  FOCUS_SOUNDS,
  FOCUS_SOUND_LABEL,
  SOUNDBOARD_LABEL,
  canPlaySounds,
  startFocusSound,
  type FocusSound,
  type FocusSoundHandle,
} from "@/lib/facilitator-timers/sounds";

/**
 * Focus sounds for quiet work: soft rain, a low hum or slow waves, made in
 * the browser. Off until someone presses Play, and they stop when this
 * page closes. The choice and the volume are remembered, never "playing".
 */
export function FocusSoundsCard({
  sound,
  volume,
  onSound,
  onVolume,
  onPlaying,
}: {
  sound: FocusSound;
  volume: number;
  onSound: (s: FocusSound) => void;
  onVolume: (v: number) => void;
  onPlaying?: (playing: boolean) => void;
}) {
  const handleRef = useRef<FocusSoundHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const volumeId = useId();

  // Leaving the page stops the sound: nothing plays without its controls on screen.
  useEffect(
    () => () => {
      handleRef.current?.stop();
      handleRef.current = null;
    },
    []
  );

  const start = (s: FocusSound) => {
    handleRef.current?.stop();
    const handle = startFocusSound(s, volume);
    handleRef.current = handle;
    setPlaying(Boolean(handle));
    onPlaying?.(Boolean(handle));
    setNote(handle ? null : "This browser can't play sounds made on the page.");
  };
  const stop = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
    onPlaying?.(false);
  };

  return (
    <SectionCard title="Focus sounds" icon={Headphones} titleSize="sm">
      <div className="flex flex-col gap-4">
        <ToggleGroup<FocusSound>
          label="Focus sound"
          size="sm"
          options={FOCUS_SOUNDS.map((s) => ({ value: s, label: FOCUS_SOUND_LABEL[s] }))}
          value={sound}
          onValueChange={(s) => {
            onSound(s);
            if (playing) start(s);
          }}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={volumeId} className="text-sm text-text">
            Volume
          </Label>
          <input
            id={volumeId}
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            aria-valuetext={`${Math.round(volume * 100)}%`}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              onVolume(v);
              handleRef.current?.setVolume(v);
            }}
            className="h-11 w-full accent-[var(--accent)]"
          />
        </div>
        <Button
          type="button"
          variant={playing ? "outline" : "default"}
          className="gap-1.5 self-start"
          aria-pressed={playing}
          onClick={() => (playing ? stop() : start(sound))}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing
            ? `Stop ${FOCUS_SOUND_LABEL[sound].toLowerCase()}`
            : `Play ${FOCUS_SOUND_LABEL[sound].toLowerCase()}`}
        </Button>
        <p className="text-xs text-sub" role="status">
          {note ??
            (playing
              ? "Playing while this page is open."
              : "Made in your browser, so nothing downloads. Off until you press Play.")}
        </p>
      </div>
    </SectionCard>
  );
}

/**
 * The soundboard on the page: the drumroll, gong, applause, ding and Amr's
 * cheer, and the switch that also shows it as a small dock while
 * presenting, on any tool.
 */
export function SoundboardCard({
  whilePresenting,
  onWhilePresenting,
  onPlayed,
}: {
  whilePresenting: boolean;
  onWhilePresenting: (on: boolean) => void;
  onPlayed?: (press: SoundboardPress) => void;
}) {
  const dockId = useId();
  const [last, setLast] = useState<string | null>(null);
  const supported = canPlaySounds();
  return (
    <SectionCard title="Soundboard" icon={Music} titleSize="sm">
      <div className="flex flex-col gap-4">
        <SoundboardButtons
          onPlayed={(press) => {
            setLast(
              press === "cheer"
                ? "Amr cheers, when he's on screen."
                : supported
                  ? `${SOUNDBOARD_LABEL[press]}.`
                  : "This browser can't play sounds made on the page."
            );
            onPlayed?.(press);
          }}
        />
        <p className="text-xs text-sub" role="status">
          {last ?? "Sounds play only when you press one, made in your browser."}
        </p>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <Label htmlFor={dockId} className="text-sm text-text">
            Show the soundboard while presenting
          </Label>
          <Switch id={dockId} checked={whilePresenting} onCheckedChange={onWhilePresenting} />
        </div>
      </div>
    </SectionCard>
  );
}
