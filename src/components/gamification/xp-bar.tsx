"use client";

import { useEffect, useState } from "react";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
import { activeAchievements } from "@/lib/gamification/achievements";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

const ACTIVE_IDS: ReadonlySet<string> = new Set(activeAchievements.map((a) => a.id));

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
 *
 * Everything it shows comes from store subscriptions: no timers, no
 * polling (the combo readout that polled every 150–500 ms is gone with
 * the combo itself).
 */
export function XpBar({ onOpenTrophyCase }: XpBarProps) {
  const [mounted, setMounted] = useState(false);
  const xp = useVDnaStore((s) => s.xp);
  const prestige = useVDnaStore((s) => s.prestige);
  // Retired badges a user still holds don't count toward the total.
  const unlockedCount = useVDnaStore((s) => s.unlocked.filter((id) => ACTIVE_IDS.has(id)).length);

  useEffect(() => {
    setMounted(true);
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
        "min-touch-coarse flex items-center gap-2 h-8 rounded-md",
        "border border-border bg-surface",
        "px-2.5 sm:px-3",
        "text-xs font-mono",
        "text-sub hover:text-text hover:border-accent",
        "transition-all duration-fast",
        "shrink-0"
      )}
    >
      {prestige > 0 && (
        <span className="flex items-center gap-0.5 text-warning shrink-0">
          <Crown className="w-3 h-3" aria-hidden="true" />
          <span className="font-data">{prestige}</span>
        </span>
      )}
      <span className="flex items-center gap-1 shrink-0">
        <span className="text-accent font-data">L{info.level}</span>
        {info.atMax && <span className="text-xs text-accent">MAX</span>}
      </span>
      {/* Decorative: a button's children are presentational, so a
          progressbar role here was never exposed — the button's
          aria-label already carries the percentage. */}
      <div
        className="relative h-1.5 rounded-full bg-bg border border-border overflow-hidden shrink-0 w-16 sm:w-24 md:w-28"
        aria-hidden="true"
      >
        <div
          className="absolute left-0 top-0 bottom-0 bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-data text-text/80 whitespace-nowrap hidden sm:inline">
        {info.atMax ? `${xp.toLocaleString()}` : `${info.xpIntoLevel}/${info.xpNeededForLevel}`}
      </span>
      <span className="hidden md:flex items-center gap-1 text-sub shrink-0">
        <span className="text-sub">·</span>
        <span className="font-data text-accent">{unlockedCount}</span>
        <span className="text-xs">ach</span>
      </span>
    </button>
  );
}
