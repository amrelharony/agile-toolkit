"use client";

/**
 * One hypothesis: its four lines, where it came from (a riskiest
 * assumption, an experiment, a Cynefin item), what it still needs, its
 * target and measured result with the verdict that result suggests, and
 * its status and days. The status, the days, the result and what was
 * learned are edited right on the card; Edit opens every field in place.
 * Each change goes through lib/hypotheses' validateHypothesis, as the
 * agent's set_status, record_result and update_hypothesis do, so a
 * hand-off draft can't run without what we'll do and the success metric,
 * and no day lands in the future or before the day it was raised.
 */

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { SourceLink } from "@/components/handoff/source-link";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Hypothesis, HypothesisStatus } from "@/lib/stores/workspace-types";
import {
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_TEXT_MAX,
  hypothesisDraftFrom,
  isResolved,
  missingFields,
  suggestVerdict,
  suggestionText,
  validateHypothesis,
  type HypothesisDraft,
  type HypothesisValues,
} from "@/lib/hypotheses/model";
import { isExampleId } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { HypothesisEditor } from "./hypothesis-form";
import { SELECT_CLASS } from "./hypothesis-fields";
import { STATUS_LABEL, missingText, statusLabel, targetText } from "./view";

const STATUS_TONE: Record<HypothesisStatus, string> = {
  drafted: "border-border text-sub",
  running: "border-info/40 bg-info/10 text-info",
  validated: "border-success/40 bg-success/10 text-success",
  invalidated: "border-danger/40 bg-danger/10 text-danger",
  inconclusive: "border-warning/40 bg-warning/10 text-warning",
};

export interface HypothesisCardProps {
  hypothesis: Hypothesis;
  today: string;
  /** Save checked values over the row (an edit, a status, a day, a result). */
  onSave: (h: Hypothesis, values: HypothesisValues, what: CardChange) => void;
  onRemove: (h: Hypothesis) => void;
}

/** What a save changed, for the page's announcement and history. */
export type CardChange = "edit" | "status" | "raised" | "resolved" | "result" | "outcome";

const firstError = (errors: Partial<Record<string, string>>) =>
  Object.values(errors).find(Boolean) ?? null;

export function HypothesisCard({ hypothesis: h, today, onSave, onRemove }: HypothesisCardProps) {
  const [editing, setEditing] = useState(false);
  const [statusError, setStatusError] = useState<{ message: string; detail: boolean } | null>(null);
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const refocusEdit = useRef(false);

  const missing = missingFields(h);
  const resolved = isResolved(h.status);
  const suggestion = suggestVerdict(h);
  const title = h.believe?.trim() || "Untitled hypothesis";

  useEffect(() => {
    if (editing || !refocusEdit.current) return;
    refocusEdit.current = false;
    editRef.current?.focus();
  }, [editing]);

  /** The saved row with `patch` typed over it, checked as the editor checks it. */
  const check = (patch: Partial<HypothesisDraft>) =>
    validateHypothesis({ ...hypothesisDraftFrom(h), ...patch }, today, { stored: h });

  /** A result's day: the one already stamped, else today (or the raised day when an agent's is later). */
  const resultDay = () => {
    const kept = (h.resolvedAt ?? "").slice(0, 10);
    if (kept) return kept;
    const raised = (h.raisedAt ?? "").slice(0, 10);
    return raised > today ? raised : today;
  };

  const setStatus = (status: HypothesisStatus) => {
    if (status === h.status) return;
    const r = check({ status, resolvedAt: isResolved(status) ? resultDay() : "" });
    if (!r.ok) {
      const detail = Boolean(r.errors.willDo || r.errors.successMetric);
      setStatusError({
        message: detail
          ? `Add ${missingText(missing)} before it moves on.`
          : (firstError(r.errors) ?? "This change can't be saved."),
        detail,
      });
      return;
    }
    setStatusError(null);
    onSave(h, r.values, "status");
  };

  const dayCheck = (key: "raisedAt" | "resolvedAt") => (day: string) => {
    const r = check({ [key]: day });
    return r.ok ? null : (r.errors[key] ?? firstError(r.errors));
  };

  if (editing) {
    return (
      <HypothesisEditor
        hypothesis={h}
        today={today}
        onSave={(values) => {
          onSave(h, values, "edit");
          refocusEdit.current = true;
          setEditing(false);
          setStatusError(null);
        }}
        onCancel={() => {
          refocusEdit.current = true;
          setEditing(false);
        }}
      />
    );
  }

  const known = (HYPOTHESIS_STATUSES as readonly string[]).includes(h.status);

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "space-y-3 rounded-lg border p-3 sm:p-4",
        resolved ? "border-border bg-surface" : "border-border bg-card",
        missing.length > 0 && "border-warning/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-sub">We believe</p>
          <h3 id={titleId} className="break-words text-sm font-medium text-text">
            {title}
          </h3>
          {/* Sent from another tool: a riskiest assumption, an experiment, a Cynefin item. */}
          <SourceLink sourceRef={h.sourceRef} className="mt-1" />
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            ref={editRef}
            label={`Edit ${title}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            // Where focus goes when the card next to it is deleted or leaves the filter.
            data-hypothesis-edit={h.id}
            onClick={() => setEditing(true)}
          />
          <IconButton
            label={`Delete ${title}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(h)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
            STATUS_TONE[h.status] ?? "border-border text-sub"
          )}
        >
          {statusLabel(h.status)}
        </span>
        {missing.length > 0 && (
          <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
            Needs detail: {missingText(missing)}
          </span>
        )}
        {isExampleId(h.id) && (
          <span className="inline-flex items-center rounded-full border border-info/30 px-2 py-0.5 text-xs text-info">
            Example
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <Line term="We will" value={h.willDo} missing={missing.includes("willDo")} />
        <Line term="To learn" value={h.toLearn} />
        <Line
          term="Success looks like"
          value={h.successMetric}
          missing={missing.includes("successMetric")}
        />
      </dl>

      {(h.experiment || h.description) && (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {h.experiment && <Line term="Experiment" value={h.experiment} small />}
          {h.description && <Line term="Context" value={h.description} small />}
        </dl>
      )}

      {h.target && (
        <div className="space-y-2 rounded-md border border-border bg-surface-deep p-2.5">
          <p className="text-sm text-text">
            <span className="text-sub">Target: </span>
            {targetText(h.target)}
          </p>
          <ResultInput hypothesis={h} check={check} onSave={(v) => onSave(h, v, "result")} />
          {suggestion && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <p className={suggestion.met ? "text-success" : "text-danger"}>{suggestionText(h)}</p>
              {h.status !== suggestion.verdict && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  aria-label={`Mark “${title}” ${suggestion.verdict}`}
                  onClick={() => setStatus(suggestion.verdict)}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Mark {suggestion.verdict}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-3 border-t border-border pt-2">
        <Field label={`Status of ${title}`} hideLabel className="w-full sm:w-40">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={h.status}
              onChange={(e) => setStatus(e.target.value as HypothesisStatus)}
            >
              {!known && <option value={h.status}>{h.status}</option>}
              {HYPOTHESIS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-sub" aria-hidden="true">
            Raised on
          </span>
          <DayInput
            label={`Raised on, ${title}`}
            value={(h.raisedAt ?? "").slice(0, 10)}
            max={today}
            validate={dayCheck("raisedAt")}
            onCommit={(day) => {
              const r = check({ raisedAt: day });
              if (r.ok) onSave(h, r.values, "raised");
            }}
            inputClassName="h-9 w-40"
          />
        </div>
        {resolved && (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-sub" aria-hidden="true">
              Result on
            </span>
            <DayInput
              label={`Result on, ${title}`}
              value={(h.resolvedAt ?? "").slice(0, 10)}
              min={(h.raisedAt ?? "").slice(0, 10) || undefined}
              max={today}
              validate={dayCheck("resolvedAt")}
              onCommit={(day) => {
                const r = check({ resolvedAt: day });
                if (r.ok) onSave(h, r.values, "resolved");
              }}
              inputClassName="h-9 w-40"
            />
          </div>
        )}
      </div>
      {statusError && (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="alert">
          <p className="text-danger">{statusError.message}</p>
          {statusError.detail && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setStatusError(null);
                setEditing(true);
              }}
            >
              Add the detail
            </Button>
          )}
        </div>
      )}

      {(resolved || h.outcome) && (
        <Field label="What we learned" className="gap-1">
          {(props) => (
            <BlurTextarea
              id={props.id}
              rows={2}
              value={h.outcome ?? ""}
              maxLength={Math.max(HYPOTHESIS_TEXT_MAX, (h.outcome ?? "").length)}
              placeholder="What did the test show?"
              className="resize-none text-sm"
              onCommit={(v) => {
                const r = check({ outcome: v });
                if (r.ok) onSave(h, r.values, "outcome");
              }}
            />
          )}
        </Field>
      )}
    </article>
  );
}

function Line({
  term,
  value,
  missing = false,
  small = false,
}: {
  term: string;
  value: string | undefined;
  missing?: boolean;
  small?: boolean;
}) {
  const text = (value ?? "").trim();
  return (
    <div className="min-w-0">
      <dt className="text-xs text-sub">{term}</dt>
      <dd
        className={cn(
          "whitespace-pre-line break-words",
          small ? "text-xs" : "text-sm",
          text ? "text-text" : missing ? "text-warning" : "text-sub"
        )}
      >
        {text || (missing ? "Needed before it runs" : "—")}
      </dd>
    </div>
  );
}

/**
 * The measured result, saved when the field is left or on Enter. Blank
 * clears it (never 0); something that isn't a number is refused, and the
 * stored result stays.
 */
function ResultInput({
  hypothesis: h,
  check,
  onSave,
}: {
  hypothesis: Hypothesis;
  check: (patch: Partial<HypothesisDraft>) => ReturnType<typeof validateHypothesis>;
  onSave: (values: HypothesisValues) => void;
}) {
  const stored = typeof h.actual === "number" && Number.isFinite(h.actual) ? String(h.actual) : "";
  const [draft, setDraft] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(stored);
    setError(null);
  }, [stored]);
  const commit = () => {
    if (draft.trim() === stored) {
      setError(null);
      return;
    }
    const r = check({ actual: draft });
    if (!r.ok) {
      setError(r.errors.actual ?? firstError(r.errors));
      return;
    }
    setError(null);
    onSave(r.values);
  };
  const unit = h.target?.unit?.trim();
  return (
    <Field
      label={`Measured result${unit ? ` (${unit})` : ""}`}
      hint={stored ? undefined : "Blank until measured."}
      error={error ?? undefined}
      className="max-w-xs gap-1"
    >
      {(props) => (
        <Input
          {...props}
          inputMode="decimal"
          className="h-9"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(stored);
              setError(null);
            }
          }}
        />
      )}
    </Field>
  );
}
