"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Siren, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { ScalePicker } from "@/components/shared/scale-picker";
import { SourceLink } from "@/components/handoff/source-link";
import { PersonInPlace } from "@/components/team/person-in-place";
import {
  RISK_LEVEL_LABEL,
  RISK_OWNER_MAX,
  RISK_STATUSES,
  RISK_STATUS_LABEL,
  RISK_TEXT_MAX,
  RISK_TITLE_MAX,
  isActiveRisk,
  residualAboveCurrent,
  residualScore,
  riskDaysOverdue,
  riskLevel,
  riskScore,
  toScale,
} from "@/lib/risks/model";
import type { Risk, RiskScale } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { closedDayError, dueDayError, raisedDayError } from "./risk-form";
import { IMPACT_STEPS, LEVEL_TONE, LIKELIHOOD_STEPS } from "./scales";
import type { RiskPatch } from "./view";

/** The impediment a risk was raised as, while it still exists. */
export interface RaisedImpediment {
  id: string;
  resolved: boolean;
}

export interface RiskRowProps {
  risk: Risk;
  /** YYYY-MM-DD, local. */
  today: string;
  /** An example row: its people aren't offered to the roster and it isn't raised anywhere. */
  example: boolean;
  impediment: RaisedImpediment | null;
  onEdit: (risk: Risk, patch: RiskPatch, field: string) => void;
  onStatus: (risk: Risk, status: Risk["status"]) => void;
  /** A closed risk's close day, backdated (never later than today or before it was raised). */
  onClosedOn: (risk: Risk, day: string) => void;
  onRaise: (risk: Risk) => void;
  onDelete: (risk: Risk) => void;
}

const titleOf = (r: Risk) => r.title.trim() || "Untitled risk";

/**
 * Focus what `target` finds once React has re-rendered: the button an
 * action was pressed on is gone by then (what it did replaces it), and
 * focus would fall to the page's body. When the action was refused the
 * target isn't there, and the button, still there, keeps focus.
 */
function focusSoon(target: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => target()?.focus());
}

/**
 * The title and the "more about it" text, edited in place: the text is a
 * button that opens InlineItemEditor. An emptied title reverts (a risk
 * keeps its name); an emptied description is removed.
 */
function TitleInPlace({
  risk,
  onSave,
}: {
  risk: Risk;
  onSave: (next: { title: string; description?: string }) => void;
}) {
  const edit = useInlineEdit();
  if (edit.editing) {
    return (
      <InlineItemEditor
        label={`Edit ${titleOf(risk)}`}
        title={risk.title}
        description={risk.description ?? ""}
        withDescription
        titleLabel="Risk"
        descriptionLabel="More about it"
        titleMaxLength={RISK_TITLE_MAX}
        descriptionMaxLength={RISK_TEXT_MAX}
        onDone={(next, { refocus }) => {
          edit.stop({ refocus });
          if (next) onSave(next);
        }}
      />
    );
  }
  return (
    <button
      ref={edit.triggerRef}
      type="button"
      data-risk-title={risk.id}
      onClick={edit.start}
      title="Click to edit"
      className="block w-full cursor-text break-words rounded-sm text-left transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className={cn("text-sm font-medium", risk.title.trim() ? "text-text" : "text-sub")}>
        {titleOf(risk)}
      </span>
      <span className="sr-only"> (edit)</span>
      {risk.description && (
        <span className="mt-0.5 block whitespace-pre-wrap text-xs text-sub">
          {risk.description}
        </span>
      )}
    </button>
  );
}

/**
 * The rating once the plan has worked: both values or neither. A pair is
 * saved as soon as both are picked, and cleared once both are cleared;
 * with one picked the other asks for its value and nothing is saved. A
 * pair that scores higher than now is saved with a warning.
 */
function ResidualEditor({
  risk,
  onSave,
}: {
  risk: Risk;
  onSave: (pair: { p: RiskScale; i: RiskScale } | null) => void;
}) {
  const assessed = residualScore(risk) !== null;
  const storedP = assessed ? toScale(risk.residualProbability) : null;
  const storedI = assessed ? toScale(risk.residualImpact) : null;
  const [draft, setDraft] = useState({ p: storedP, i: storedI });
  // A change from elsewhere (an agent, Undo, another device) replaces the draft.
  useEffect(() => setDraft({ p: storedP, i: storedI }), [storedP, storedI]);

  const set = (next: { p: RiskScale | null; i: RiskScale | null }) => {
    setDraft(next);
    if (next.p !== null && next.i !== null) {
      if (next.p !== storedP || next.i !== storedI) onSave({ p: next.p, i: next.i });
    } else if (next.p === null && next.i === null && assessed) {
      onSave(null);
    }
  };
  const half = (draft.p === null) !== (draft.i === null);
  const after = assessed ? residualScore(risk) : null;

  return (
    <div
      role="group"
      aria-label={`After mitigation: ${titleOf(risk)}`}
      className="space-y-2 rounded-md border border-border p-3"
    >
      <p className="text-xs text-sub">
        After mitigation:{" "}
        <span className="text-text">
          {after === null ? "Not assessed" : `${after} (${RISK_LEVEL_LABEL[riskLevel(after)]})`}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ScalePicker
          label="Likelihood after"
          size="sm"
          steps={LIKELIHOOD_STEPS}
          value={draft.p}
          onValueChange={(v) => set({ p: v as RiskScale, i: draft.i })}
          onClear={() => set({ p: null, i: draft.i })}
          error={half && draft.p === null ? "Rate this too, or clear both." : undefined}
        />
        <ScalePicker
          label="Impact after"
          size="sm"
          steps={IMPACT_STEPS}
          value={draft.i}
          onValueChange={(v) => set({ p: draft.p, i: v as RiskScale })}
          onClear={() => set({ p: draft.p, i: null })}
          error={half && draft.i === null ? "Rate this too, or clear both." : undefined}
        />
      </div>
      {residualAboveCurrent(risk) && (
        <p className="text-xs text-warning" role="status">
          After mitigation it scores {after}, higher than {riskScore(risk)} now. Saved as it is;
          check the ratings.
        </p>
      )}
    </div>
  );
}

/** A small label above a control whose own accessible name says whose it is. */
function Caption({ children }: { children: string }) {
  return (
    <span className="text-xs text-sub" aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * One risk, edited in place: its title and description, the two ratings
 * (with the score and level beside them), the status (closing takes a
 * day, backdatable), the owner from the roster, the raised and due days
 * (saved when the field is left, never per keystroke), the plan, and the
 * rating after mitigation. "Raise as impediment" hands an active risk to
 * the Impediments log once it happened; once that impediment is resolved
 * the row offers to close the risk. Delete has Undo.
 */
export function RiskRow({
  risk: r,
  today,
  example,
  impediment,
  onEdit,
  onStatus,
  onClosedOn,
  onRaise,
  onDelete,
}: RiskRowProps) {
  const statusId = useId();
  const statusRef = useRef<HTMLSelectElement>(null);
  const impedimentRef = useRef<HTMLAnchorElement>(null);
  const score = riskScore(r);
  const level = riskLevel(score);
  const after = residualScore(r);
  const overdue = riskDaysOverdue(r, today);
  const active = isActiveRisk(r);
  const name = titleOf(r);
  const closedDay = r.status === "closed" ? (r.resolvedAt ?? "").slice(0, 10) : "";

  return (
    <li id={`risk-${r.id}`} className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <TitleInPlace
            risk={r}
            onSave={(next) =>
              onEdit(r, { title: next.title, description: next.description }, "title")
            }
          />
        </div>
        <span
          className={cn(
            "inline-flex h-8 shrink-0 items-center rounded-md border px-2 font-data text-sm",
            LEVEL_TONE[level]
          )}
        >
          <span className="sr-only">Score </span>
          {score}
          <span className="ml-1 font-sans text-xs">{RISK_LEVEL_LABEL[level]}</span>
        </span>
        <IconButton
          label={`Delete ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="h-8 w-8 text-sub hover:text-danger"
          onClick={() => onDelete(r)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Mitigation {overdue === 1 ? "1 day" : `${overdue} days`} overdue
          </span>
        )}
        {after !== null && (
          <span className="text-sub">
            Now {score} → after {after}
          </span>
        )}
        <SourceLink sourceRef={r.sourceRef} />
        {impediment && (
          <Link
            ref={impedimentRef}
            href="/impediments"
            className={cn(
              "inline-flex items-center gap-1 underline-offset-2 hover:underline",
              impediment.resolved ? "text-success" : "text-sub hover:text-accent"
            )}
          >
            {impediment.resolved ? "Its impediment is resolved" : "Raised as an impediment"}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only"> (open the Impediments log)</span>
          </Link>
        )}
      </div>

      <div
        role="group"
        aria-label={`Ratings for ${name}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <ScalePicker
          label="Likelihood"
          size="sm"
          steps={LIKELIHOOD_STEPS}
          value={toScale(r.probability)}
          onValueChange={(v) => onEdit(r, { probability: v as RiskScale }, "probability")}
        />
        <ScalePicker
          label="Impact"
          size="sm"
          steps={IMPACT_STEPS}
          value={toScale(r.impact)}
          onValueChange={(v) => onEdit(r, { impact: v as RiskScale }, "impact")}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={statusId} className="text-xs text-sub">
            Status
          </label>
          <select
            ref={statusRef}
            id={statusId}
            aria-label={`Status of ${name}`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={r.status}
            onChange={(e) => onStatus(r, e.target.value as Risk["status"])}
          >
            {RISK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RISK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {r.status === "closed" && (
            <div className="flex flex-col gap-1">
              <Caption>Closed on</Caption>
              <DayInput
                label={`Closed on, ${name}`}
                value={closedDay}
                max={today}
                inputClassName="h-9"
                validate={(day) => closedDayError(day, r.raisedAt, today)}
                onCommit={(day) => onClosedOn(r, day)}
              />
            </div>
          )}
        </div>
        {/* The group names the risk: the owner button's own name ("Owner: Priya. Change") doesn't. */}
        <div role="group" aria-label={`Owner of ${name}`} className="min-w-0">
          <PersonInPlace
            label="Owner"
            name={r.owner ?? ""}
            emptyText="No owner"
            maxLength={RISK_OWNER_MAX}
            offerAddToRoster={!example}
            onSave={(owner) => onEdit(r, { owner }, "owner")}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>Raised on</Caption>
          <DayInput
            label={`Raised on, ${name}`}
            value={r.raisedAt.slice(0, 10)}
            max={today}
            inputClassName="h-9"
            validate={(day) => {
              const why = raisedDayError(day, today);
              if (why) return why;
              if (r.mitigationDueAt && day > r.mitigationDueAt)
                return "Pick a day on or before the mitigation's due day.";
              if (closedDay && day > closedDay) return "Pick a day on or before it was closed.";
              return null;
            }}
            onCommit={(day) => onEdit(r, { raisedAt: day }, "raisedAt")}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>Mitigation plan</Caption>
          <BlurTextarea
            rows={2}
            value={r.mitigation ?? ""}
            maxLength={RISK_TEXT_MAX}
            onCommit={(v) => onEdit(r, { mitigation: v.trim() }, "mitigation")}
            placeholder="What the team will do about it"
            className="text-sm"
            aria-label={`Mitigation plan for ${name}`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>Mitigation due</Caption>
          <DayInput
            label={`Mitigation due, ${name}`}
            value={(r.mitigationDueAt ?? "").slice(0, 10)}
            min={r.raisedAt.slice(0, 10) || undefined}
            inputClassName="h-9"
            validate={(day) => dueDayError(day, r.raisedAt.slice(0, 10))}
            onCommit={(day) => onEdit(r, { mitigationDueAt: day }, "mitigationDueAt")}
          />
        </div>
      </div>

      <ResidualEditor
        risk={r}
        onSave={(pair) =>
          onEdit(
            r,
            pair
              ? { residualProbability: pair.p, residualImpact: pair.i }
              : { residualProbability: undefined, residualImpact: undefined },
            "residual"
          )
        }
      />

      {active && !example && (
        <div className="flex flex-wrap items-center gap-2">
          {impediment?.resolved ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Close the risk: ${name}`}
              onClick={() => {
                onStatus(r, "closed");
                // The actions go once it's closed; the status now reads Closed.
                focusSoon(() => statusRef.current);
              }}
            >
              Close the risk
            </Button>
          ) : (
            !impediment && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1"
                disabled={!r.title.trim()}
                aria-label={`Raise as impediment: ${name}`}
                onClick={() => {
                  onRaise(r);
                  focusSoon(() => impedimentRef.current);
                }}
              >
                <Siren aria-hidden="true" />
                Raise as impediment
              </Button>
            )
          )}
          <span className="text-xs text-sub">
            {impediment?.resolved
              ? "The impediment it was raised as is resolved."
              : impediment
                ? "It happened: the Impediments log is working on it."
                : "It happened? Raise it as an impediment; its level becomes the severity."}
          </span>
        </div>
      )}
    </li>
  );
}
