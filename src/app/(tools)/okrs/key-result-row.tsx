"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardCheck, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Progress } from "@/components/ui/progress";
import type { KeyResult, KeyResultCheckIn } from "@/lib/stores/workspace-types";
import {
  CHECK_IN_STALE_DAYS,
  CONFIDENCE_BAND_LABEL,
  confidenceBand,
  daysSinceCheckIn,
  isConfidence,
  krBaseline,
  krDirection,
  krPercent,
  krProgressText,
  lastCheckIn,
  type ConfidenceBand,
} from "@/lib/okrs/progress";
import { fmt } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import { CheckInForm } from "./check-in-form";
import { dayLabel } from "./chart-text";
import { keyResultDraft, type KeyResultValues } from "./forms";
import { KeyResultForm } from "./key-result-form";

/** Theme tokens per band: the word is always shown too, so colour is never the only cue. */
export const BAND_TONE: Record<ConfidenceBand, string> = {
  "off-track": "border-danger/40 text-danger bg-danger/10",
  "at-risk": "border-warning/40 text-warning bg-warning/10",
  "on-track": "border-success/40 text-success bg-success/10",
};

/** The confidence badge: the score and its band, or "Not scored". */
export function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  const band = confidenceBand(confidence);
  if (!band || !isConfidence(confidence)) {
    return (
      <Badge variant="outline" className="text-sub">
        Confidence not scored
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={BAND_TONE[band]}>
      Confidence {fmt(confidence)}/10 · {CONFIDENCE_BAND_LABEL[band]}
    </Badge>
  );
}

/** A number with the key result's unit: "26%", "640 payments". */
export function withUnit(kr: Pick<KeyResult, "unit">, n: number): string {
  const unit = kr.unit?.trim() ?? "";
  return unit === "%" ? `${fmt(n, 4)}%` : unit ? `${fmt(n, 4)} ${unit}` : fmt(n, 4);
}

type Mode = "view" | "edit" | "check-in";

/**
 * One key result: how far it is from its baseline to its target (lib/okrs),
 * its confidence, its last check-in (flagged after CHECK_IN_STALE_DAYS),
 * and its check-in history. "Check in" records the value on a day; Edit
 * turns the row into its form, in place. The current value only changes
 * through check-ins, so every change has a day.
 */
export function KeyResultRow({
  kr,
  today,
  onEdit,
  onDelete,
  onCheckIn,
  onRemoveCheckIn,
}: {
  kr: KeyResult;
  today: string;
  onEdit: (values: KeyResultValues) => void;
  onDelete: () => void;
  onCheckIn: (values: Omit<KeyResultCheckIn, "id">) => void;
  onRemoveCheckIn: (checkIn: KeyResultCheckIn) => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const editRef = useRef<HTMLButtonElement>(null);
  const checkInRef = useRef<HTMLButtonElement>(null);
  // The control that opened the form gets focus back when it closes.
  const returnTo = useRef<"edit" | "check-in" | null>(null);
  useEffect(() => {
    if (mode !== "view" || !returnTo.current) return;
    (returnTo.current === "edit" ? editRef : checkInRef).current?.focus();
    returnTo.current = null;
  }, [mode]);
  const close = (from: "edit" | "check-in") => {
    returnTo.current = from;
    setMode("view");
  };

  const title = kr.title.trim() || "Untitled key result";
  const pct = krPercent(kr);
  const direction = krDirection(kr);
  const base = krBaseline(kr);
  const last = lastCheckIn(kr);
  const days = daysSinceCheckIn(kr, today);
  const stale = days !== null && days >= CHECK_IN_STALE_DAYS;
  const history = [...(kr.checkIns ?? [])].reverse();

  if (mode === "edit") {
    return (
      <li className="rounded-md border border-accent/40 bg-bg p-3">
        <KeyResultForm
          initial={keyResultDraft(kr)}
          requireBaseline={base !== null}
          submitLabel="Save key result"
          onSave={(values) => {
            onEdit(values);
            close("edit");
          }}
          onCancel={() => close("edit")}
        />
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded-md border border-border bg-bg p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-text">{title}</p>
          {kr.description && (
            <p className="mt-0.5 break-words text-xs text-sub">{kr.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            ref={checkInRef}
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            aria-expanded={mode === "check-in"}
            aria-label={`Check in on ${title}`}
            onClick={() => setMode(mode === "check-in" ? "view" : "check-in")}
          >
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Check in
          </Button>
          <IconButton
            ref={editRef}
            label={`Edit key result: ${title}`}
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => setMode("edit")}
            className="text-sub hover:text-text"
          />
          <IconButton
            label={`Delete key result: ${kr.title.trim() || "untitled"}`}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onDelete}
            className="text-sub hover:text-danger"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Progress
          value={pct}
          className="h-2 min-w-[120px] flex-1"
          aria-label={`${title}: ${pct}% of the way`}
        />
        <span className="font-data text-sm text-text">{pct}%</span>
      </div>
      <p className="text-xs text-sub">
        <span className="inline-flex items-center gap-1">
          {direction === "decrease" ? (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          )}
          <span className="sr-only">{direction === "decrease" ? "Going down:" : "Going up:"}</span>
          <span className="text-text">{krProgressText(kr)}</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <ConfidenceBadge confidence={kr.confidence} />
        {last ? (
          <span className={cn(stale ? "text-warning" : "text-sub")}>
            {stale
              ? `No check-in for ${days} days`
              : `Checked in ${dayLabel(last.date)}${days === 0 ? " (today)" : ""}`}
          </span>
        ) : (
          <span className="text-sub">No check-in yet</span>
        )}
        {base === null && (
          <span className="text-sub">
            No baseline: progress counts from 0. Edit it to set where it started.
          </span>
        )}
      </div>

      {mode === "check-in" && (
        <CheckInForm
          kr={kr}
          today={today}
          now={withUnit(kr, kr.current)}
          onSave={(values) => {
            onCheckIn(values);
            close("check-in");
          }}
          onCancel={() => close("check-in")}
        />
      )}

      {history.length > 0 && (
        <details className="group rounded-md border border-border bg-surface">
          <summary className="flex min-h-9 cursor-pointer select-none list-none items-center gap-2 px-3 py-1.5 text-xs text-sub [&::-webkit-details-marker]:hidden">
            {history.length === 1 ? "1 check-in" : `${history.length} check-ins`}
          </summary>
          <ul
            className="divide-y divide-border border-t border-border"
            aria-label={`Check-ins on ${title}`}
          >
            {history.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs"
              >
                <span className="font-data text-text">{dayLabel(c.date)}</span>
                <span className="font-data text-text">{withUnit(kr, c.value)}</span>
                <span className="text-sub">
                  {krPercent({ ...kr, current: c.value })}% of the way
                </span>
                <span className="text-sub">
                  {isConfidence(c.confidence) ? `Confidence ${fmt(c.confidence)}/10` : "Not scored"}
                </span>
                {c.note && <span className="min-w-0 flex-1 break-words text-sub">“{c.note}”</span>}
                <IconButton
                  label={`Delete the check-in of ${dayLabel(c.date)} on ${title}`}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => onRemoveCheckIn(c)}
                  className="ml-auto text-sub hover:text-danger"
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
