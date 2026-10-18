"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
import { cn } from "@/lib/utils";
import { TrophyCase } from "./trophy-case";

export function TrophyButton() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const xp = useVDnaStore((s) => s.xp);
  const prestige = useVDnaStore((s) => s.prestige);

  useEffect(() => {
    setMounted(true);
  }, []);

  const level = mounted ? computeLevel(xp, prestige).level : 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-no-sound="true"
        className={cn(
          "min-touch-coarse relative w-8 h-8 rounded-lg flex items-center justify-center",
          "text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
        )}
        title={mounted ? `Level ${level} · open trophy case` : "Trophy case"}
        // The level badge is visible text; keep it in the name instead of
        // letting the label hide it.
        aria-label={mounted ? `Open trophy case, level ${level}` : "Open trophy case"}
        aria-haspopup="dialog"
      >
        <Trophy className="w-4 h-4" />
        {mounted && (
          <span className="absolute -bottom-0.5 -right-0.5 text-xs font-data font-bold text-accent bg-bg rounded px-1 leading-tight">
            {level}
          </span>
        )}
      </button>
      <TrophyCase open={open} onOpenChange={setOpen} />
    </>
  );
}
