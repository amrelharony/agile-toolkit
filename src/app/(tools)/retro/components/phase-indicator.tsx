"use client";

/**
 * Retro phase stepper — renders the Write → Vote → Discuss → Actions pills
 * and the "Next Phase" advance button (hidden on the final phase).
 */

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHASES, type BoardPhase } from "../types";

export function PhaseIndicator({
  current,
  onAdvance,
}: {
  current: BoardPhase;
  onAdvance: () => void;
}) {
  const idx = PHASES.findIndex((p) => p.key === current);
  const isLast = idx === PHASES.length - 1;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.map((phase, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "upcoming";
        return (
          <div key={phase.key} className="flex items-center gap-1">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                state === "active"
                  ? "bg-accent-cyan/20 text-accent border-accent-cyan shadow-neon-cyan"
                  : state === "done"
                    ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                    : "bg-cardH text-sub border-border"
              }`}
            >
              {i + 1}. {phase.label}
            </span>
            {i < PHASES.length - 1 && <ChevronRight className="w-3 h-3 text-sub" />}
          </div>
        );
      })}
      {!isLast && (
        <Button
          size="sm"
          variant="outline"
          onClick={onAdvance}
          className="ml-2 h-7 px-3 text-xs border-border text-sub hover:border-accent-cyan/50 hover:text-accent"
        >
          Next Phase <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      )}
    </div>
  );
}
