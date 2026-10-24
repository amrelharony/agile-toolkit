"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHASE_HINT, PHASE_LABEL, PREMORTEM_PHASES, type PremortemPhase } from "../model";

/**
 * Write → Group → Vote → Act. The facilitator moves the room on; every step
 * stays reachable, so going back to add a cause someone remembered late is
 * one click. On a phone the steps scroll sideways instead of widening the
 * page.
 */
export function PhaseStepper({
  phase,
  onChange,
  activeRef,
}: {
  phase: PremortemPhase;
  onChange: (phase: PremortemPhase) => void;
  /** The current step's button, where focus goes when the Next button is gone (the last phase). */
  activeRef?: (el: HTMLElement | null) => void;
}) {
  const current = PREMORTEM_PHASES.indexOf(phase);
  const hintId = useId();
  return (
    <nav aria-label="Premortem phases" className="mb-4">
      <ol className="scroll-x-snap pb-1">
        {PREMORTEM_PHASES.map((p, i) => {
          const active = p === phase;
          const done = i < current;
          return (
            // A fixed width on phones, so the hint wraps instead of making
            // each step as wide as its sentence.
            <li key={p} className="w-44 md:w-auto md:flex-1">
              <button
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onChange(p)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${i + 1} of ${PREMORTEM_PHASES.length}: ${PHASE_LABEL[p]}`}
                aria-describedby={`${hintId}-${p}`}
                className={cn(
                  "flex h-full w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active
                    ? "border-accent/50 bg-accent/10 text-text"
                    : "border-border bg-surface text-sub hover:border-accent/40 hover:text-text"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                    active
                      ? "border-accent bg-accent text-bg"
                      : done
                        ? "border-success/60 text-success"
                        : "border-border"
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{PHASE_LABEL[p]}</span>
                  <span id={`${hintId}-${p}`} className="block text-xs text-sub">
                    {PHASE_HINT[p]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
