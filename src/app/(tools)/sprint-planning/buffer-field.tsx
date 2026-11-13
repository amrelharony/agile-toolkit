"use client";

/**
 * The sprint's interrupt buffer, set while planning: a share of the sprint's
 * planned points, or points, kept free for unplanned work. It is saved the
 * way the Interrupt Buffer page and Amr save it (`Sprint.interruptBuffer`,
 * `{pct}` or `{points}`), so a share comes to the same points everywhere
 * (lib/sprints/interrupts `bufferPoints`); the Interrupt Buffer tool logs
 * what lands in it. The line under the field reads the points in the
 * sprint now, before they are committed.
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
  cleanBuffer,
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
 * What the buffer keeps with the points in the sprint now, and how much of
 * the commitment that leaves for stories: "Keeps 6 points of the 30 for
 * interrupts: plan about 24 points of stories." A share is of the planned
 * points, so the stories that fit a target with it are target / (1 + share).
 * Null with no buffer.
 */
export function bufferPlanLine(
  sprint: Pick<Sprint, "interruptBuffer">,
  plannedPoints: number,
  targetPoints: number | null
): string | null {
  const buffer = cleanBuffer(sprint.interruptBuffer);
  if (!buffer) return null;
  const target = targetPoints !== null && targetPoints > 0 ? targetPoints : null;
  if (buffer.points !== undefined) {
    return target === null
      ? `Keeps ${pointsText(buffer.points)} for interrupts.`
      : `Keeps ${pointsText(buffer.points)} of the ${target} for interrupts: plan about ${pointsText(round1(Math.max(0, target - buffer.points)))} of stories.`;
  }
  const pct = buffer.pct ?? 0;
  const planned = Number.isFinite(plannedPoints) && plannedPoints > 0 ? plannedPoints : 0;
  const now =
    planned > 0 ? bufferPoints({ interruptBuffer: buffer, pointsPlanned: planned }) : null;
  const kept =
    now !== null
      ? `${pct}% of the ${planned} points planned keeps ${pointsText(now)} for interrupts.`
      : `${pct}% of the points planned is kept for interrupts, once stories are in.`;
  return target === null
    ? kept
    : `${kept} To fit ${target} with it, plan about ${pointsText(round1(target / (1 + pct / 100)))} of stories.`;
}

export function PlanningBuffer({
  sprint,
  plannedPoints,
  targetPoints,
  disabled,
  example,
  onSave,
}: {
  sprint: Sprint;
  /** The points of the stories in the sprint now (committed or not). */
  plannedPoints: number;
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
    if (!sameBuffer(v.values, sprint.interruptBuffer)) onSave(v.values);
  };

  const line = bufferPlanLine(sprint, plannedPoints, targetPoints);
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
          label={draft.mode === "pct" ? "Share of the points planned" : "Buffer points"}
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
