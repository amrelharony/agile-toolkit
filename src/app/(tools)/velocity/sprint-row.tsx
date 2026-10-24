"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Sprint } from "@/lib/stores/workspace-types";
import { SAY_DO_GRADE_LABEL, type SayDoGrade } from "@/lib/sprints/metrics";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import { parseNumber } from "@/lib/utils/form";
import { cn } from "@/lib/utils";
import { perDayText, shouldOfferClose, sprintDates, statusLabel, type VelocityRow } from "./view";

const numberCls =
  "bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20";

const POINTS_ERROR = "Enter 0 or more points.";

/**
 * A points draft checked before it is saved: the number, null for a blank
 * that may be cleared, or the message to show. A negative or non-number is
 * an error, never clamped or dropped.
 */
export function validatePoints(
  text: string,
  allowBlank: boolean
): { ok: true; value: number | null } | { ok: false; error: string } {
  const n = parseNumber(text);
  if (n === undefined)
    return allowBlank ? { ok: true, value: null } : { ok: false, error: POINTS_ERROR };
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: POINTS_ERROR };
  return { ok: true, value: n };
}

/**
 * A points field that doesn't snap mid-edit: it keeps what is typed and
 * saves on blur or Enter, only when the number changed. A bad number shows
 * why under the field and keeps the draft; Escape puts the saved value
 * back. Blank clears the value when `allowBlank`, else it is an error.
 */
function PointsCell({
  value,
  onCommit,
  allowBlank = false,
  placeholder,
  label,
}: {
  value: number | null;
  onCommit: (n: number | null) => void;
  allowBlank?: boolean;
  placeholder?: string;
  label: string;
}) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(shown);
    setError(null);
  }, [shown]);
  const commit = () => {
    const check = validatePoints(draft, allowBlank);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    if (check.value !== value) onCommit(check.value);
    else setDraft(shown);
  };
  return (
    <Field label={label} hideLabel error={error ?? undefined}>
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode="decimal"
          min={0}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(shown);
              setError(null);
            }
          }}
          className={numberCls}
        />
      )}
    </Field>
  );
}

/** A text field that commits on blur or Enter. A required one reverts when left blank. */
function TextCell({
  value,
  onCommit,
  required = false,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const text = draft.trim();
    if (required && !text) {
      setDraft(value);
      return;
    }
    if (text !== value.trim()) onCommit(text);
  };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder={placeholder}
      maxLength={120}
      className={className}
      aria-label={ariaLabel}
    />
  );
}

const STATUS_TONE: Record<Sprint["status"], string> = {
  planned: "border-border text-sub",
  active: "border-accent/40 text-accent",
  completed: "border-success/40 text-success",
  cancelled: "border-border text-sub line-through",
};

/** Say/do grades in the status colours (the label says it in words too). */
export const GRADE_TONE: Record<SayDoGrade, string> = {
  met: "text-success",
  close: "text-warning",
  missed: "text-danger",
  over: "text-info",
};

function SprintMeta({ row, sprint }: { row: VelocityRow; sprint: Sprint }) {
  const dates = sprintDates(sprint);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sub">
      <span className={cn("rounded border px-1.5 py-px font-medium", STATUS_TONE[row.status])}>
        {statusLabel(row.status)}
      </span>
      {dates ?? <span>No dates</span>}
    </div>
  );
}

/** The finished sprint's say/do and points per person-day, under its numbers. */
function Outcome({ row, linkPlans }: { row: VelocityRow; linkPlans: boolean }) {
  if (!row.finished) return null;
  return (
    <p className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-xs sm:order-last sm:col-span-4">
      {row.sayDo ? (
        <span className={cn("font-medium", GRADE_TONE[row.sayDo.grade])}>
          Say/do {row.sayDo.pct}% · {SAY_DO_GRADE_LABEL[row.sayDo.grade]}
        </span>
      ) : (
        <span className="text-sub">No commitment to compare with</span>
      )}
      {row.perDay !== null ? (
        <span className="text-sub">
          {perDayText(row.perDay)} points per person-day ({row.personDays} person-days)
        </span>
      ) : linkPlans ? (
        <Link
          href={sprintHref("/capacity-planner", row.id)}
          className="text-accent underline-offset-2 hover:underline"
        >
          Plan its capacity for points per person-day
        </Link>
      ) : null}
    </p>
  );
}

export interface SprintRowProps {
  row: VelocityRow;
  sprint: Sprint;
  /** The sprint the sprint tools are looking at. */
  selected: boolean;
  /** Example preview: show the numbers, change nothing. */
  readOnly?: boolean;
  /** YYYY-MM-DD, local. */
  today: string;
  onRename?: (name: string) => void;
  onGoal?: (goal: string) => void;
  onCommitted?: (n: number) => void;
  onCompleted?: (n: number | null) => void;
  /** Open the close dialog (carry-over, one Undo). */
  onRequestClose?: () => void;
  onRemove?: () => void;
}

/** One shared sprint in the Velocity table. */
export function SprintRow({
  row,
  sprint,
  selected,
  readOnly = false,
  today,
  onRename,
  onGoal,
  onCommitted,
  onCompleted,
  onRequestClose,
  onRemove,
}: SprintRowProps) {
  const label = row.name || "sprint";
  const open = row.status === "planned" || row.status === "active";
  const ended = shouldOfferClose(sprint, today);
  const undated = sprintDates(sprint) === null;
  const rowCls = cn(
    "grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_0.6fr_0.6fr_auto] gap-2 sm:gap-3 sm:items-start rounded-md border p-2 sm:border-0 sm:p-1",
    selected ? "border-accent/40 bg-accent/5" : "border-border"
  );

  if (readOnly) {
    return (
      <div className={rowCls} aria-current={selected ? "true" : undefined}>
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium text-text">{row.name}</p>
          {row.description && <p className="truncate text-xs text-sub">{row.description}</p>}
          <SprintMeta row={row} sprint={sprint} />
        </div>
        <span className="w-9 sm:order-last" aria-hidden="true" />
        <ReadOnlyPoints label="Committed" value={row.committed} />
        <ReadOnlyPoints label="Completed" value={row.completed} />
        <Outcome row={row} linkPlans={false} />
      </div>
    );
  }

  return (
    <div className={rowCls} aria-current={selected ? "true" : undefined}>
      <div className="min-w-0 space-y-1">
        <TextCell
          value={row.name}
          required
          onCommit={(v) => onRename?.(v)}
          className="input-toolkit focus:ring-accent/20"
          aria-label="Sprint name"
        />
        <TextCell
          value={row.description ?? ""}
          onCommit={(v) => onGoal?.(v)}
          placeholder="Goal (optional)"
          className="input-toolkit h-7 text-xs"
          aria-label={`Goal for ${label}`}
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SprintMeta row={row} sprint={sprint} />
          {undated && (
            <Link
              href={sprintHref("/sprint", row.id)}
              className="text-xs text-accent underline-offset-2 hover:underline"
            >
              Set dates
            </Link>
          )}
        </div>
      </div>
      <IconButton
        variant="danger-ghost"
        label={`Remove ${label}`}
        icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
        onClick={onRemove}
        className="min-touch-coarse h-9 w-9 justify-self-end sm:order-last"
      />
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <span className="text-xs font-medium uppercase tracking-wider text-sub sm:hidden">
          Committed
        </span>
        <PointsCell
          value={row.committed}
          onCommit={(n) => {
            if (n !== null) onCommitted?.(n);
          }}
          label={`Committed points for ${label}`}
        />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <span className="text-xs font-medium uppercase tracking-wider text-sub sm:hidden">
          Completed
        </span>
        <PointsCell
          value={row.completed}
          allowBlank
          placeholder="Not yet"
          onCommit={(n) => onCompleted?.(n)}
          label={`Completed points for ${label}`}
        />
        {open && ended ? (
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-sub">
            <span>{row.name || "This sprint"} has ended. Close it?</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRequestClose}
              className="h-7 gap-1 px-2 text-xs"
              aria-label={`Close ${label}`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Close sprint
            </Button>
          </div>
        ) : (
          open &&
          row.completed !== null && (
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-sub">
              <span>Counts once the sprint is done.</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onRequestClose}
                className="h-7 gap-1 px-2 text-xs"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Mark done
              </Button>
            </div>
          )
        )}
      </div>
      <Outcome row={row} linkPlans />
    </div>
  );
}

function ReadOnlyPoints({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="col-span-2 flex items-baseline gap-2 sm:col-span-1 sm:block">
      <span className="text-xs font-medium uppercase tracking-wider text-sub sm:hidden">
        {label}
      </span>
      <span className="font-data text-text">{value ?? "—"}</span>
    </div>
  );
}
