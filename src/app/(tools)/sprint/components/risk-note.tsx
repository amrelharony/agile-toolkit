"use client";

import { useRef, useState } from "react";
import { AiButton } from "@/components/ai";
import { Button } from "@/components/ui/button";
import type { AiSource } from "@/lib/ai/task-types";
import {
  RISK_NOTE_REASONS_MAX,
  sprintRiskNoteTask,
  type RiskNoteInput,
} from "@/lib/ai/tasks/sprint";
import type { SprintRisk } from "@/lib/sprints/risk";
import type { Sprint } from "@/lib/stores/workspace-types";

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
 * "Why, and what to try" under the goal check (`CockpitRisk`): Amr's short
 * plain note on the reasons, or the rule's own sentences without AI. It is
 * only shown, nothing is saved from it, and it shows only while the facts it
 * was written from still hold: unblock a story or resolve an impediment and
 * it goes, so it never states a reason that is no longer true.
 *
 * Its own module, which `CockpitRisk` loads only when it draws the note
 * (next/dynamic): the AI kit and the task's schemas stay out of the
 * Cockpit's first load.
 */
export function RiskNote({
  risk,
  sprint,
  day,
  length,
}: {
  risk: SprintRisk;
  sprint: Pick<Sprint, "id" | "name" | "goal">;
  /** Today's sprint day, for the note. */
  day: number | null;
  /** The sprint's last day. */
  length: number;
}) {
  const askRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<{
    text: string;
    source: AiSource;
    sprintId: string;
    /** The facts the note was written from (riskNoteInput, as JSON). */
    facts: string;
  } | null>(null);
  const input = riskNoteInput(risk, sprint, day, length);
  const facts = JSON.stringify(input);
  // A note written for another sprint, or from facts that have changed since, never shows.
  const shown = note && note.sprintId === sprint.id && note.facts === facts ? note : null;
  return (
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
  );
}
