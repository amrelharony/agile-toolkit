"use client";

/**
 * The sprint's interrupt buffer, set while planning: a share of the points
 * to commit to, or points, kept free for unplanned work. A share is saved
 * with the points it comes to at the commitment typed now
 * (`Sprint.interruptBuffer` {pct, points}), so the buffer stays what was
 * planned when the commitment later changes; the Interrupt Buffer tool
 * logs what lands in it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Sprint, SprintInterruptBuffer } from "@/lib/stores/workspace-types";
import {
  BUFFER_PCT_MAX,
  bufferDraftFor,
  bufferLabel,
  bufferPoints,
  pointsText,
  sameBuffer,
  validateBufferDraft,
  type BufferDraft,
} from "@/lib/sprints/interrupts";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";

const round1 = (n: number) => Math.round(n * 10) / 10;

const SELECT =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-card px-3 text-base pointer-fine:md:text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * What to store for the draft: a share also keeps the points it is of the
 * commitment, when there is one to take it of.
 */
export function bufferToSave(
  values: SprintInterruptBuffer | undefined,
  targetPoints: number | null
): SprintInterruptBuffer | undefined {
  if (!values) return undefined;
  if (values.pct !== undefined && targetPoints !== null && targetPoints > 0) {
    return { pct: values.pct, points: round1((targetPoints * values.pct) / 100) };
  }
  return values;
}

/** "Keeps 6 points for interrupts: plan about 24 points of stories." */
export function bufferPlanLine(
  sprint: Pick<Sprint, "interruptBuffer" | "pointsPlanned">,
  targetPoints: number | null
): string | null {
  const pts = bufferPoints(sprint);
  if (pts === null) return null;
  if (targetPoints === null || targetPoints <= 0) {
    return `Keeps ${pointsText(pts)} for interrupts.`;
  }
  const rest = round1(Math.max(0, targetPoints - pts));
  return `Keeps ${pointsText(pts)} of the ${targetPoints} for interrupts: plan about ${pointsText(rest)} of stories.`;
}

export function PlanningBuffer({
  sprint,
  targetPoints,
  disabled,
  example,
  onSave,
}: {
  sprint: Sprint;
  /** The points to commit to (typed or suggested), or null. */
  targetPoints: number | null;
  /** A closed sprint can't be planned. */
  disabled: boolean;
  example: boolean;
  onSave: (buffer: SprintInterruptBuffer | undefined) => void;
}) {
  const [draft, setDraft] = useState<BufferDraft>(() => bufferDraftFor(sprint));
  const [error, setError] = useState<string | undefined>();
  const key = JSON.stringify(sprint.interruptBuffer ?? null);
  useEffect(() => {
    setDraft(bufferDraftFor(sprint));
    setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sprint.id]);

  const save = () => {
    const v = validateBufferDraft(draft);
    if (!v.ok) {
      setError(v.errors.value);
      return;
    }
    setError(undefined);
    const next = bufferToSave(v.values, targetPoints);
    if (!sameBuffer(next, sprint.interruptBuffer)) onSave(next);
  };

  const line = bufferPlanLine(sprint, targetPoints);
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface/40 p-3" data-field="buffer">
      <p className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Shield className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        Interrupt buffer <span className="font-normal text-sub">· {bufferLabel(sprint)}</span>
      </p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="mt-2 flex flex-wrap items-end gap-2"
      >
        <Field label="Keep for interrupts" className="w-44">
          {(control) => (
            <select
              {...control}
              className={SELECT}
              value={draft.mode}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value as BufferDraft["mode"] })}
            >
              <option value="pct">A share (%)</option>
              <option value="points">Points</option>
            </select>
          )}
        </Field>
        <Field
          label={draft.mode === "pct" ? "Share of the commitment" : "Buffer points"}
          hideLabel
          className="w-28"
          error={error}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              max={draft.mode === "pct" ? BUFFER_PCT_MAX : undefined}
              step="any"
              disabled={disabled}
              placeholder={draft.mode === "pct" ? "%" : "points"}
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            />
          )}
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={disabled}>
          Save the buffer
        </Button>
      </form>
      <p className="mt-2 text-xs text-sub">
        {line ?? "Blank keeps no buffer. A team that supports a live product usually keeps 10–20%."}{" "}
        {!example && (
          <Link
            href={sprintHref("/interrupt-buffer", sprint.id)}
            className="text-accent hover:underline"
          >
            Interrupt Buffer
          </Link>
        )}
      </p>
    </div>
  );
}
