"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX, Sparkles } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { getEngine } from "@/lib/sonification/engine";
import { useSonification } from "@/lib/sonification/use-sonification";
import { useSonificationContext } from "@/lib/sonification/provider";
import type { SonificationMode } from "@/lib/sonification/types";
import { cn } from "@/lib/utils";

const MODE_OPTIONS: { id: SonificationMode; label: string; blurb: string }[] = [
  { id: "full", label: "Full", blurb: "UI + tool-specific signatures" },
  { id: "minimal", label: "Minimal", blurb: "Only clicks, hovers, presence" },
  { id: "ambient", label: "Ambient", blurb: "Just scroll filter + stereo pan" },
];

export function SonificationToggle() {
  const {
    enabled,
    masterVolume,
    mode,
    respectReducedMotion,
    toggleEnabled,
    setMasterVolume,
    setMode,
    setRespectReducedMotion,
  } = useSonificationStore();
  const { reducedMotion, kick } = useSonificationContext();
  const { emit } = useSonification();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return; // only handle primary click
    // Force AudioContext init from this gesture.
    kick();
    const next = !enabled;
    toggleEnabled();
    if (next) {
      // After store flip, play confirmation chord on the next tick.
      setTimeout(() => {
        emit("ui", "confirm");
      }, 30);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    kick();
    setOpen((v) => !v);
  };

  // BUG-C6: keyboard reach for the settings popover. Right-click is
  // mouse-only; without this handler keyboard users can never open
  // the volume/mode/test-sound popover. Bind to Shift+Enter so the
  // primary Enter still toggles audio on/off and the secondary
  // action stays discoverable from the tooltip ("Audio on — right-
  // click or Shift+Enter for settings").
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && e.shiftKey) {
      e.preventDefault();
      kick();
      setOpen((v) => !v);
    }
  };

  const handleTestSound = () => {
    kick();
    emit("ui", "toast-success");
  };

  const tooltip = !mounted
    ? undefined
    : enabled
      ? respectReducedMotion && reducedMotion
        ? "Audio silenced (reduced motion)"
        : "Audio on — right-click or Shift+Enter for settings"
      : "Audio off — click to enable";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          data-no-sound="true"
          title={tooltip}
          className={cn(
            "min-touch-coarse w-8 h-8 rounded-lg flex items-center justify-center",
            "text-sub hover:text-accent hover:bg-accent/5",
            "transition-all duration-fast",
            enabled && "text-accent"
          )}
          aria-label={tooltip}
          aria-pressed={enabled}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {!mounted ? (
            <div className="w-4 h-4" />
          ) : enabled ? (
            <Volume2
              className={cn("w-4 h-4", reducedMotion && respectReducedMotion && "opacity-40")}
            />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-72 bg-surface border-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text">Sonification</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="sonification-enabled" className="text-xs text-sub">
            Enabled
          </label>
          <Switch
            id="sonification-enabled"
            checked={enabled}
            onCheckedChange={(v) => {
              kick();
              useSonificationStore.getState().setEnabled(v);
              if (v) setTimeout(() => emit("ui", "confirm"), 30);
            }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-sub mb-2">
            <span>Volume</span>
            <span className="font-data text-text">{Math.round(masterVolume * 100)}%</span>
          </div>
          <Slider
            value={[Math.round(masterVolume * 100)]}
            onValueChange={(v) => {
              const pct = v[0] ?? 0;
              setMasterVolume(pct / 100);
              getEngine().setMasterVolume(pct / 100);
            }}
            min={0}
            max={100}
            step={1}
          />
        </div>

        <div>
          <div className="text-xs text-sub mb-2">Mode</div>
          <div className="grid grid-cols-3 gap-1">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cn(
                  "text-[10px] uppercase tracking-wider py-1.5 rounded border transition",
                  mode === m.id
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border bg-bg text-sub hover:text-text"
                )}
                title={m.blurb}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-text">Respect reduced motion</div>
            <div className="text-[10px] text-sub">
              {reducedMotion ? "System requests reduced motion" : "System allows animations"}
            </div>
          </div>
          <Switch checked={respectReducedMotion} onCheckedChange={setRespectReducedMotion} />
        </div>

        <button
          type="button"
          onClick={handleTestSound}
          className="w-full py-1.5 text-xs rounded-md border border-border bg-bg text-sub hover:text-accent hover:border-accent/30 transition"
        >
          Test sound
        </button>
      </PopoverContent>
    </Popover>
  );
}
