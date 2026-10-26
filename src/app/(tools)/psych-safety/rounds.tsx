"use client";

import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { fmt } from "@/lib/charts/chart-text";
import type { PsychSafetyRound, Sprint } from "@/lib/stores/workspace-types";
import { ROUND_NAME_MAX, roundDateProblem, roundResult } from "@/lib/psych-safety/instrument";
import { DayField } from "../health-check/day-field";
import { NameField } from "../health-check/name-field";

const SOURCE: Record<PsychSafetyRound["source"], string> = {
  room: "Live round",
  facilitator: "Counted by hand",
  legacy: "Answer sheets from before rounds",
};

export interface RoundListProps {
  /** Oldest first, as roundsOf gives them; listed newest first. */
  rounds: readonly PsychSafetyRound[];
  sprints: readonly Sprint[];
  today: string;
  readOnly: boolean;
  /** Saves a good name and returns null, or returns why it can't (blank). */
  onRename: (r: PsychSafetyRound, name: string) => string | null;
  onRedate: (r: PsychSafetyRound, date: string) => void;
  onRemove: (r: PsychSafetyRound) => void;
}

/**
 * Every round, newest first: its name and day edited in place, how it was
 * taken, how many answered, its team score (from five responses), and
 * Delete with Undo. The legacy round (the answer sheets kept before
 * rounds) is read-only. A day is kept when the field is left, not as it
 * is typed: the list is sorted by it, so a half-typed year would move the
 * row under the cursor. Each Delete is marked `data-focus-key`
 * ("delete:<id>") so the page can put focus back after one.
 */
export function RoundList({
  rounds,
  sprints,
  today,
  readOnly,
  onRename,
  onRedate,
  onRemove,
}: RoundListProps) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {[...rounds].reverse().map((r) => {
        const result = roundResult(r);
        const sprint = r.sprintId ? sprints.find((s) => s.id === r.sprintId) : undefined;
        const editable = !readOnly && r.source !== "legacy";
        return (
          <li key={r.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-end md:gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              {editable ? (
                <NameField
                  name={r.name}
                  label={`Name of the round ${r.name}`}
                  maxLength={ROUND_NAME_MAX}
                  onRename={(next) => onRename(r, next)}
                  className="max-w-sm"
                />
              ) : (
                <p className="text-sm font-medium text-text">{r.name}</p>
              )}
              <p className="text-xs text-sub">
                {SOURCE[r.source]} · {r.responses} {r.responses === 1 ? "response" : "responses"}
                {sprint ? ` · ${sprint.name}` : ""}
                {" · "}
                {result && result.teamScore !== null
                  ? `team score ${fmt(result.teamScore)}/5`
                  : "too few responses to show"}
              </p>
            </div>
            {editable ? (
              <DayField
                label={
                  // Seen as "Taken on"; heard with the round it belongs to, since every row has one.
                  <>
                    <span aria-hidden="true">Taken on</span>
                    <span className="sr-only">Date of the round {r.name}</span>
                  </>
                }
                value={r.date}
                max={today}
                problem={(day) => roundDateProblem(day, today)}
                onChange={(day) => onRedate(r, day)}
                commit="blur"
              />
            ) : (
              <p className="text-xs text-sub">{r.date}</p>
            )}
            <span data-focus-key={`delete:${r.id}`} className="self-end md:self-auto">
              <IconButton
                label={`Delete the round ${r.name}`}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                disabled={readOnly}
                onClick={() => onRemove(r)}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
