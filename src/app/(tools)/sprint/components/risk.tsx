"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { AiButton } from "@/components/ai";
import { Button } from "@/components/ui/button";
import type { AiSource } from "@/lib/ai/task-types";
import {
  RISK_NOTE_REASONS_MAX,
  sprintRiskNoteTask,
  type RiskNoteInput,
} from "@/lib/ai/tasks/sprint";
import { RISK_LEVEL_LABEL, type SprintRisk } from "@/lib/sprints/risk";
import type { Sprint } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** What the AI note reads: the rule's facts, cut to the task's caps. */
export function riskNoteInput(
  risk: SprintRisk,
  sprint: Pick<Sprint, "name" | "goal">,
  day: number | null,
  length: number
): RiskNoteInput {
  const goal = sprint.goal?.trim();
  return {
    sprint: clip(sprint.name.trim() || "This sprint", 120),
    ...(goal ? { goal: clip(goal, 400) } : {}),
    day: Math.max(0, Math.min(400, day ?? 0)),
    length: Math.max(1, Math.min(400, length)),
    level: risk.level,
    headline: clip(risk.headline, 240),
    reasons: risk.reasons.slice(0, RISK_NOTE_REASONS_MAX).map((r) => ({
      level: r.level,
      text: clip(r.text, 300),
      tryThis: clip(r.tryThis, 300),
    })),
  };
}

/**
 * The goal check: whether the sprint goal is at risk, the reasons the rule
 * found and a thing to try for each (lib/sprints/risk). "Why, and what to
 * try" asks Amr for a short plain note on top; it is only shown, nothing is
 * saved from it, and without AI the rule's own sentences answer. The note
 * shows only while the facts it was written from still hold: unblock a
 * story or resolve an impediment and it goes, so it never states a reason
 * that is no longer true. A sprint
 * on track gets one quiet line; one that isn't running gets nothing (the
 * verdict says where it stands).
 */
export function CockpitRisk({
  risk,
  sprint,
  day,
  length,
  compact = false,
  withNote = true,
}: {
  risk: SprintRisk;
  sprint: Pick<Sprint, "id" | "name" | "goal">;
  /** Today's sprint day, for the note. */
  day: number | null;
  /** The sprint's last day. */
  length: number;
  /** The home card: the reasons without the things to try, and no note. */
  compact?: boolean;
  /** Offer the note (not in the read-only example: it reads the team's own sprint). */
  withNote?: boolean;
}) {
  const headingId = useId();
  const askRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<{
    text: string;
    source: AiSource;
    sprintId: string;
    /** The facts the note was written from (riskNoteInput, as JSON). */
    facts: string;
  } | null>(null);
  if (!risk.applies) return null;
  if (risk.level === "none") {
    return (
      <p className="flex items-start gap-2 text-sm text-sub" data-risk="none">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <span>{risk.headline}</span>
      </p>
    );
  }
  const atRisk = risk.level === "at_risk";
  const Icon = atRisk ? AlertTriangle : Eye;
  const input = riskNoteInput(risk, sprint, day, length);
  const facts = JSON.stringify(input);
  // A note written for another sprint, or from facts that have changed since, never shows.
  const shown = note && note.sprintId === sprint.id && note.facts === facts ? note : null;
  return (
    <section
      aria-labelledby={headingId}
      data-risk={risk.level}
      className={cn(
        "space-y-3 rounded-lg border p-3 sm:p-4",
        atRisk ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn("mt-0.5 h-4 w-4 shrink-0", atRisk ? "text-destructive" : "text-warning")}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-text">
            Goal check: {RISK_LEVEL_LABEL[risk.level].toLowerCase()}
          </h2>
          <p className="break-words text-sm text-text">{risk.headline}</p>
        </div>
      </div>
      <ul className="space-y-2 text-sm" aria-label="Reasons">
        {risk.reasons.map((r) => (
          <li key={r.id} data-risk-reason={r.id} className="min-w-0 break-words">
            <span
              className={cn(
                "mr-1 font-medium",
                r.level === "at_risk" ? "text-destructive" : "text-warning"
              )}
            >
              {RISK_LEVEL_LABEL[r.level]}:
            </span>
            <span className="text-text">{r.text}</span>
            {!compact && <span className="block text-sub">Try: {r.tryThis}</span>}
          </li>
        ))}
      </ul>
      {!compact && withNote && (
        <div className="space-y-2" ref={askRef}>
          <AiButton
            task={sprintRiskNoteTask}
            label="Why, and what to try"
            fallbackLabel="Sum it up without AI"
            input={() => input}
            onResult={(data, meta) =>
              setNote({ text: data.note, source: meta.source, sprintId: sprint.id, facts })
            }
          />
          {shown && (
            <div className="rounded-md border border-border bg-card p-3" data-risk-note>
              <p className="text-xs text-sub">
                {shown.source === "ai" ? "Amr's note (AI, not saved)" : "Summed up without AI"}
              </p>
              <p role="status" className="whitespace-pre-line break-words text-sm text-text">
                {shown.text}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => {
                  // This button goes with the note: focus goes back to the one that asked for it.
                  askRef.current
                    ?.querySelector<HTMLElement>('[data-testid="ai-button"]')
                    ?.focus({ preventScroll: true });
                  setNote(null);
                }}
              >
                Hide the note
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
