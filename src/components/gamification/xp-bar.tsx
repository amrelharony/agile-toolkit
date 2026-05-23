"use client";

import { useEffect, useState } from "react";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
import { getCombo } from "@/lib/gamification/engine";
import { Crown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface XpBarProps {
  onOpenTrophyCase?: () => void;
}

/**
 * Header XP pill — opens the trophy case on click.
 *
 * Lives inline inside the header action cluster (previously was a
 * fixed-bottom floating pill, moved up for a cleaner page surface).
 * Responsive:
 *   - xs (mobile): level chip + tight progress bar only
 *   - sm+:        + xp/needed counter
 *   - md+:        + achievements count
 *   - any:         combo multiplier badge when active
 */
export function XpBar({ onOpenTrophyCase }: XpBarProps) {
  const [mounted, setMounted] = useState(false);
  const xp = useVDnaStore((s) => s.xp);
  const prestige = useVDnaStore((s) => s.prestige);
  const unlockedCount = useVDnaStore((s) => s.unlocked.length);
  const [comboDepth, setComboDepth] = useState(0);
  const [comboMult, setComboMult] = useState(1);

  useEffect(() => {
    setMounted(true);
    // Combo readout: poll at 500 ms when idle, 150 ms when actively comboing.
    // The previous flat 150 ms ran 6.6 wakeups/sec on every page for the
    // entire session even when nothing was happening, which on low-end
    // mobile is a measurable battery cost. The bumped cadence kicks in
    // automatically once a combo starts.
    let pollId: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const c = getCombo();
      setComboDepth(c.depth);
      setComboMult(c.multiplier);
      const nextInterval = c.depth >= 1 && c.multiplier > 1 ? 150 : 500;
      if (pollId !== null) clearInterval(pollId);
      pollId = setInterval(tick, nextInterval);
    };
    tick();
    return () => {
      if (pollId !== null) clearInterval(pollId);
    };
  }, []);

  // Reserve layout space pre-mount so the header doesn't shift on hydrate.
  if (!mounted) return <div className="h-8 w-28 sm:w-44 md:w-56" aria-hidden="true" />;
  const info = computeLevel(xp, prestige);
  const pct = Math.round(info.progress01 * 100);

  return (
    <button
      type="button"
      onClick={onOpenTrophyCase}
      data-no-sound="true"
      aria-label={`Level ${info.level}, ${pct}% to next level. ${unlockedCount} achievements. Open trophy case.`}
      title="Open trophy case"
      className={cn(
        "flex items-center gap-2 h-8 rounded-full",
        "border border-border bg-surface/60 backdrop-blur-sm",
        "px-2.5 sm:px-3",
        "text-[10px] sm:text-[11px] font-mono uppercase tracking-wider",
        "text-sub hover:text-text hover:border-accent/40 hover:bg-surface",
        "transition-all duration-fast",
        "shrink-0"
      )}
    >
      {prestige > 0 && (
        <span className="flex items-center gap-0.5 text-amber-300 shrink-0">
          <Crown className="w-3 h-3" aria-hidden="true" />
          <span className="font-data">{prestige}</span>
        </span>
      )}
      <span className="flex items-center gap-1 shrink-0">
        <span className="text-accent font-data">L{info.level}</span>
        {info.atMax && <span className="text-[9px] text-accent">MAX</span>}
      </span>
      <div
        className="relative h-1.5 rounded-full bg-bg border border-border/60 overflow-hidden shrink-0 w-16 sm:w-24 md:w-28"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-accent to-accent-2 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-data text-text/80 whitespace-nowrap hidden sm:inline">
        {info.atMax
          ? `${xp.toLocaleString()}`
          : `${info.xpIntoLevel}/${info.xpNeededForLevel}`}
      </span>
      <span className="hidden md:flex items-center gap-1 text-sub shrink-0">
        <span className="text-sub/50">·</span>
        <span className="font-data text-accent">{unlockedCount}</span>
        <span className="text-[9px]">ach</span>
      </span>
      {comboDepth >= 1 && comboMult > 1 && (
        <span className="flex items-center gap-0.5 text-amber-300 animate-pulse shrink-0">
          <Zap className="w-3 h-3" aria-hidden="true" />
          <span className="font-data">×{comboMult}</span>
        </span>
      )}
    </button>
  );
}
