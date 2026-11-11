"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "@/components/motion/transition-link";
import { ArrowRight, CheckCircle2, ListPlus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { ScalePicker } from "@/components/shared/scale-picker";
import { SmartInput } from "@/components/shared/smart-input";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { toScale } from "@/lib/risks/model";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import {
  DEBT_AREA_MAX,
  DEBT_TEXT_MAX,
  DEBT_TITLE_MAX,
  isInterestEstimated,
  isOpenDebt,
  type RankedDebt,
} from "@/lib/tech-debt/model";
import { cn } from "@/lib/utils";
import { ageLabel, scoreSum } from "./analysis";
import { parseInterest, raisedDayError, resolvedDayError } from "./debt-form";
import { DEBT_EFFORT_STEPS, DEBT_IMPACT_STEPS } from "./scales";
import type { DebtPatch } from "./view";

/** The backlog story an item was sent to, while it still exists. */
export interface BacklogStory {
  id: string;
  done: boolean;
}

export interface DebtRowProps {
  ranked: RankedDebt;
  sprintLengthDays: number;
  /** YYYY-MM-DD, local. */
  today: string;
  /** An example row: it isn't sent to the backlog. */
  example: boolean;
  /**
   * Whether the interest field offers the predictor's suggestion. Off
   * while the example is loaded: the predictor reads every item in the
   * workspace, the example's included. Defaults to on.
   */
  suggestInterest?: boolean;
  story: BacklogStory | null;
  onEdit: (item: TechDebtItem, patch: DebtPatch, field: string) => void;
  onResolve: (item: TechDebtItem) => void;
  /** A paid-down item's day, backdated (never later than today or before it was raised). */
  onResolvedOn: (item: TechDebtItem, day: string) => void;
  onReopen: (item: TechDebtItem) => void;
  onSend: (item: TechDebtItem) => void;
  onDelete: (item: TechDebtItem) => void;
}

const titleOf = (t: TechDebtItem) => t.title.trim() || "Untitled item";

/** No suggestion: no ghost, no chip, and Tab moves on. */
const NO_SUGGESTION = { value: 0, confidence: "none" } as const;

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
 * The title and the description, edited in place: the text is a button
 * that opens InlineItemEditor. An emptied title reverts; an emptied
 * description is removed.
 */
function TitleInPlace({
  item,
  onSave,
}: {
  item: TechDebtItem;
  onSave: (next: { title: string; description?: string }) => void;
}) {
  const edit = useInlineEdit();
  if (edit.editing) {
    return (
      <InlineItemEditor
        label={`Edit ${titleOf(item)}`}
        title={item.title}
        description={item.description ?? ""}
        withDescription
        titleLabel="Debt"
        descriptionLabel="Description"
        titleMaxLength={DEBT_TITLE_MAX}
        descriptionMaxLength={DEBT_TEXT_MAX}
        onDone={(next, { refocus }) => {
          edit.stop({ refocus });
          if (next) onSave(next);
        }}
      />
    );
  }
  const open = isOpenDebt(item);
  return (
    <button
      ref={edit.triggerRef}
      type="button"
      data-debt-title={item.id}
      onClick={edit.start}
      title="Click to edit"
      className="block w-full cursor-text break-words rounded-sm text-left transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span
        className={cn(
          "text-sm font-medium",
          !item.title.trim() ? "text-sub" : open ? "text-text" : "text-sub line-through"
        )}
      >
        {titleOf(item)}
      </span>
      <span className="sr-only"> (edit)</span>
      {item.description && (
        <span className="mt-0.5 block whitespace-pre-wrap text-xs text-sub">
          {item.description}
        </span>
      )}
    </button>
  );
}

/**
 * The interest per sprint, saved when the field is left or on Enter. An
 * emptied field is "not estimated" (undefined), never 0; a value that
 * isn't a number from 0 to 100 isn't saved and says why. A text field
 * (with the decimal keypad), not type="number": a number input hands
 * "1e", "-" or "1,5" over as "", which read as an emptied field and
 * erased the estimate without a word. The predictor's suggestion shows as
 * a chip to accept (and Tab accepts it once it is more than a
 * low-confidence guess), unless `suggest` is off.
 */
function InterestRateInput({
  value,
  commit,
  itemLabel,
  suggest,
}: {
  value: number | undefined;
  commit: (next: number | undefined) => void;
  itemLabel: string;
  suggest: boolean;
}) {
  const shown = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const lastShown = useRef(shown);
  // A change from elsewhere (an agent, Undo, another device) replaces the draft.
  useEffect(() => {
    if (lastShown.current === shown) return;
    lastShown.current = shown;
    setDraft(shown);
    setError(null);
  }, [shown]);
  // The hook runs either way (hooks keep their order); with `suggest` off
  // its value isn't offered. lib/predictions/bootstrap's interestRate
  // predictor doesn't leave example ids out yet, so the page holds it back
  // while the example is loaded.
  const predicted = usePredictedDefault<number>("tech-debt", "interestRate", 0.5);
  const pred = suggest ? predicted : NO_SUGGESTION;

  const save = () => {
    if (draft === shown) {
      setError(null);
      return;
    }
    const parsed = parseInterest(draft);
    setError(parsed.error ?? null);
    if (!parsed.error) commit(parsed.value);
  };

  return (
    <SmartInput<number>
      predicted={pred}
      onAccept={(v) => {
        setDraft(String(v));
        setError(null);
        commit(v);
      }}
      render={({ ghost, accept, chip }) => (
        <div className="flex flex-col gap-1">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(parseInterest(e.target.value).error ?? null);
            }}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (
                e.key === "Tab" &&
                draft === "" &&
                ghost &&
                pred.confidence !== "low" &&
                pred.confidence !== "none"
              ) {
                e.preventDefault();
                accept();
              }
            }}
            placeholder={ghost ?? "Not estimated"}
            className="h-9 font-data"
            aria-label={`Interest per sprint for ${itemLabel}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          {draft === "" && chip}
        </div>
      )}
    />
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
 * One debt item, edited in place: its title and description, the area,
 * the two ratings, the interest per sprint, the day it was raised
 * (backdatable), its age in sprints of the team's cadence and the capped
 * score with how it adds up. "Mark resolved" (with Undo) takes a day;
 * "Add to backlog" puts an open item on the backlog as a story, and once
 * that story is done the row says so. Delete has Undo.
 */
export function DebtRow({
  ranked,
  sprintLengthDays,
  today,
  example,
  suggestInterest = true,
  story,
  onEdit,
  onResolve,
  onResolvedOn,
  onReopen,
  onSend,
  onDelete,
}: DebtRowProps) {
  const { item: t, ageSprints, score } = ranked;
  const resolveRef = useRef<HTMLButtonElement>(null);
  const paidDownRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLAnchorElement>(null);
  const name = titleOf(t);
  const open = isOpenDebt(t);
  const resolvedDay = (t.resolvedAt ?? "").slice(0, 10);

  return (
    <li id={`debt-${t.id}`} className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <TitleInPlace
            item={t}
            onSave={(next) =>
              onEdit(t, { title: next.title, description: next.description }, "title")
            }
          />
        </div>
        <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 font-data text-sm text-text">
          <span className="font-sans text-xs text-sub">Score</span>
          {Math.round(score.total * 10) / 10}
          {score.capped && <span className="font-sans text-xs text-warning">capped</span>}
        </span>
        <IconButton
          label={`Delete ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="h-8 w-8 text-sub hover:text-danger"
          onClick={() => onDelete(t)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sub">
        <span>{ageLabel(ageSprints, sprintLengthDays)}</span>
        <span>
          <span className="sr-only">Score: </span>
          {scoreSum(t, score)}
        </span>
        {!isInterestEstimated(t) && <span>Interest not estimated</span>}
        {!open && <span className="text-success">Paid down {resolvedDay}</span>}
        {/* Tags come from agents (tool.tech_debt.add_tag); shown so they aren't hidden data. */}
        {(t.tags ?? []).length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1">
            <span className="sr-only">Tags:</span>
            {(t.tags ?? []).map((tag) => (
              <span key={tag} className="rounded border border-border px-1.5 py-0.5 text-sub">
                {tag}
              </span>
            ))}
          </span>
        )}
        {story && (
          <Link
            ref={storyRef}
            href="/sprint-planning"
            className={cn(
              "inline-flex items-center gap-1 underline-offset-2 hover:underline",
              story.done ? "text-success" : "hover:text-accent"
            )}
          >
            {story.done ? "Its backlog story is done" : "On the backlog"}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only"> (open Sprint Planning)</span>
          </Link>
        )}
      </div>

      <div
        role="group"
        aria-label={`Ratings for ${name}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <ScalePicker
          label="Impact"
          size="sm"
          steps={DEBT_IMPACT_STEPS}
          value={toScale(t.impact)}
          onValueChange={(v) => onEdit(t, { impact: v as TechDebtItem["impact"] }, "impact")}
        />
        <ScalePicker
          label="Effort"
          size="sm"
          steps={DEBT_EFFORT_STEPS}
          value={toScale(t.effort)}
          onValueChange={(v) => onEdit(t, { effort: v as TechDebtItem["effort"] }, "effort")}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>Area</Caption>
          <BlurInput
            value={t.area ?? ""}
            maxLength={DEBT_AREA_MAX}
            onCommit={(v) => onEdit(t, { area: v.trim() }, "area")}
            placeholder="No area"
            className="h-9"
            aria-label={`Area of ${name}`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>Interest per sprint</Caption>
          <InterestRateInput
            value={t.interestRate}
            commit={(interestRate) => onEdit(t, { interestRate }, "interestRate")}
            itemLabel={name}
            suggest={suggestInterest}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>Raised on</Caption>
          <DayInput
            label={`Raised on, ${name}`}
            value={t.raisedAt.slice(0, 10)}
            max={today}
            inputClassName="h-9"
            validate={(day) => {
              const why = raisedDayError(day, today);
              if (why) return why;
              return resolvedDay && day > resolvedDay
                ? "Pick a day on or before it was paid down."
                : null;
            }}
            onCommit={(day) => onEdit(t, { raisedAt: day }, "raisedAt")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {open ? (
          <Button
            ref={resolveRef}
            type="button"
            size="sm"
            variant={story?.done ? "outline" : "ghost"}
            className="gap-1"
            aria-label={`Mark resolved: ${name}`}
            onClick={() => {
              onResolve(t);
              // On the day it was paid down, to backdate it.
              focusSoon(() => paidDownRef.current?.querySelector("input"));
            }}
          >
            <CheckCircle2 aria-hidden="true" />
            Mark resolved
          </Button>
        ) : (
          <>
            <div ref={paidDownRef} className="flex flex-col gap-1">
              <Caption>Paid down on</Caption>
              <DayInput
                label={`Paid down on, ${name}`}
                value={resolvedDay}
                max={today}
                inputClassName="h-9"
                validate={(day) => resolvedDayError(day, t.raisedAt, today)}
                onCommit={(day) => onResolvedOn(t, day)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1"
              aria-label={`Reopen: ${name}`}
              onClick={() => {
                onReopen(t);
                focusSoon(() => resolveRef.current);
              }}
            >
              <RotateCcw aria-hidden="true" />
              Reopen
            </Button>
          </>
        )}
        {open && !example && !story && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={!t.title.trim()}
            aria-label={`Add to backlog: ${name}`}
            onClick={() => {
              onSend(t);
              focusSoon(() => storyRef.current);
            }}
          >
            <ListPlus aria-hidden="true" />
            Add to backlog
          </Button>
        )}
        {open && story?.done && (
          <span className="text-xs text-sub">
            The story it went to is done: mark the debt resolved if it&apos;s paid down.
          </span>
        )}
      </div>
    </li>
  );
}
