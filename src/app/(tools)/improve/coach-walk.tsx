"use client";

/**
 * Coach me: a short coaching talk over the Kata, one question at a time
 * (lib/improve/coaching's COACH_STEPS). The answers stay in the walk until
 * Finish or "Save and stop", which save them in one write with one Undo;
 * leaving midway saves nothing. Every answer may be skipped.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TOOL_TEXT_MAX, type Improvement } from "@/lib/stores/workspace-types";
import {
  coachStepsFor,
  nextLookProblem,
  type CoachAnswers,
  type CoachStepId,
} from "@/lib/improve/coaching";
import { hasCondition, isDay, lastExperiment } from "@/lib/improve/model";
import { latestCheckInDay } from "@/lib/okrs/progress";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { todayIso } from "@/lib/sprints/series";
import { FieldLabel, parseValue } from "./fields";
import { COACH_REFUSAL_TEXT, short, type CoachSaveRefusal } from "./use-item-actions";

/** The day `n` days after `day`. */
function daysAfter(day: string, n: number): string {
  const d = isoDayNumber(day);
  return d === null ? day : isoFromDayNumber(d + n);
}

interface Draft {
  result: string;
  learned: string;
  readingDate: string;
  readingValue: string;
  readingNote: string;
  aim: "keep" | "change" | "reached";
  targetText: string;
  targetValue: string;
  targetDate: string;
  obstacle: string;
  newObstacle: string;
  tryText: string;
  tryExpect: string;
  nextLook: string;
}

/** Why the answers on step `id` can't be kept yet, or null. */
function stepProblem(id: CoachStepId, d: Draft, today: string): string | null {
  if (id === "number" && d.readingValue.trim()) {
    const v = parseValue(d.readingValue);
    if (v === undefined || !Number.isFinite(v)) return "Give the reading as a number.";
    if (!isDay(d.readingDate)) return "Give the day as a real date.";
    if (d.readingDate > latestCheckInDay(today, false)) {
      return "A reading can't be for a day that hasn't come yet.";
    }
  }
  if (id === "aim" && d.aim === "change") {
    const v = parseValue(d.targetValue);
    if (v !== undefined && !Number.isFinite(v)) return "Give the target as a number.";
    if (d.targetDate && !isDay(d.targetDate)) return "Give the date as a real day.";
  }
  if (id === "next-try" && (d.tryText.trim() || d.tryExpect.trim())) {
    if (!d.tryText.trim()) return "Say what you'll try.";
    if (!d.tryExpect.trim()) return "Say what you expect before you try.";
  }
  if (id === "next-look" && d.nextLook) {
    const why = nextLookProblem(d.nextLook, today);
    if (why) return COACH_REFUSAL_TEXT[why];
  }
  return null;
}

/** The walk's answers as the model takes them. */
function answersOf(d: Draft, item: Improvement, reached: Set<CoachStepId>): CoachAnswers {
  const out: CoachAnswers = {};
  if (reached.has("since")) {
    if (d.result.trim()) out.result = d.result;
    if (d.learned.trim()) out.learned = d.learned;
  }
  if (reached.has("number") && d.readingValue.trim()) {
    out.reading = {
      date: d.readingDate,
      value: parseValue(d.readingValue) as number,
      ...(d.readingNote.trim() ? { note: d.readingNote } : {}),
    };
  }
  if (reached.has("aim")) {
    const aim = hasCondition(item.target) ? d.aim : "change";
    out.aim = aim;
    if (aim === "change") {
      out.target = {
        text: d.targetText,
        value: parseValue(d.targetValue),
        date: d.targetDate || undefined,
      };
    }
  }
  if (reached.has("obstacle")) {
    if (d.obstacle === "new" && d.newObstacle.trim()) out.newObstacle = d.newObstacle;
    else if (d.obstacle && d.obstacle !== "new") out.obstacleId = d.obstacle;
  }
  if (reached.has("next-try") && d.tryText.trim()) {
    out.nextTry = { text: d.tryText, expect: d.tryExpect };
  }
  if (reached.has("next-look") && d.nextLook) out.nextLook = d.nextLook;
  return out;
}

export function CoachWalk({
  item,
  onSave,
  onClose,
}: {
  item: Improvement;
  /** Save the talk; the refusal (which step, if one, and why), or null once saved. */
  onSave: (answers: CoachAnswers) => CoachSaveRefusal | null;
  /** Leave the walk (after a save, or without one). */
  onClose: (saved: boolean) => void;
}) {
  const ids = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const today = todayIso();
  const [steps] = useState(() => coachStepsFor(item));
  const [at, setAt] = useState(0);
  const [reached, setReached] = useState<Set<CoachStepId>>(() => new Set([steps[0].id]));
  const [error, setError] = useState<string | null>(null);
  const working = item.obstacles.find((o) => o.status === "working");
  const [draft, setDraft] = useState<Draft>(() => ({
    result: "",
    learned: "",
    readingDate: today,
    readingValue: "",
    readingNote: "",
    aim: "keep",
    targetText: item.target.text,
    targetValue: item.target.value === undefined ? "" : String(item.target.value),
    targetDate: item.target.date ?? "",
    obstacle: working?.id ?? "",
    newObstacle: "",
    tryText: "",
    tryExpect: "",
    nextLook: daysAfter(today, 2),
  }));
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const step = steps[at];
  const last = at === steps.length - 1;
  const hasTarget = hasCondition(item.target);

  useEffect(() => {
    headingRef.current?.focus();
  }, [at]);

  const go = (to: number) => {
    const why = to > at ? stepProblem(step.id, draft, today) : null;
    if (why) {
      setError(why);
      return;
    }
    setError(null);
    setAt(to);
    setReached((r) => new Set(r).add(steps[to].id));
  };

  const save = () => {
    const why = stepProblem(step.id, draft, today);
    if (why) {
      setError(why);
      return;
    }
    const refusal = onSave(answersOf(draft, item, reached));
    if (refusal) {
      const back = steps.findIndex((s) => s.id === refusal.step);
      if (back >= 0) setAt(back);
      setError(COACH_REFUSAL_TEXT[refusal.reason]);
      return;
    }
    onClose(true);
  };

  const field = (id: string) => `${ids}-${id}`;
  const lastTry = lastExperiment(item);

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="space-y-4 rounded-lg border border-accent bg-card p-4"
    >
      <div className="space-y-1">
        <p className="text-xs font-medium text-sub">
          Coaching talk · step {at + 1} of {steps.length}
        </p>
        <h3
          id={`${ids}-heading`}
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {step.title}
        </h3>
        <p className="text-sm text-text">{step.question(item)}</p>
      </div>

      {step.id === "since" && lastTry && (
        <div className="grid gap-3 sm:grid-cols-2">
          {lastTry.expect && (
            <p className="text-sm text-sub sm:col-span-2">You expected: {lastTry.expect}</p>
          )}
          <div className="min-w-0">
            <FieldLabel htmlFor={field("result")}>What you saw</FieldLabel>
            <Textarea
              id={field("result")}
              rows={2}
              value={draft.result}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => update({ result: e.target.value })}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel htmlFor={field("learned")}>What you know now</FieldLabel>
            <Textarea
              id={field("learned")}
              rows={2}
              value={draft.learned}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => update({ learned: e.target.value })}
            />
          </div>
        </div>
      )}

      {step.id === "number" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <FieldLabel htmlFor={field("reading-value")}>
              {item.current.metric ?? item.target.metric ?? "The number"}
              {(item.target.unit ?? item.current.unit)
                ? ` (${item.target.unit ?? item.current.unit})`
                : ""}
            </FieldLabel>
            <Input
              id={field("reading-value")}
              inputMode="decimal"
              value={draft.readingValue}
              onChange={(e) => update({ readingValue: e.target.value })}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel htmlFor={field("reading-date")}>Day read</FieldLabel>
            <Input
              id={field("reading-date")}
              type="date"
              max={latestCheckInDay(today, false)}
              value={draft.readingDate}
              onChange={(e) => update({ readingDate: e.target.value })}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel htmlFor={field("reading-note")}>Reading note</FieldLabel>
            <Input
              id={field("reading-note")}
              value={draft.readingNote}
              maxLength={TOOL_TEXT_MAX.short}
              onChange={(e) => update({ readingNote: e.target.value })}
            />
          </div>
          <p className="text-xs text-sub sm:col-span-3">Leave it blank if you didn’t measure.</p>
        </div>
      )}

      {step.id === "aim" && (
        <div className="space-y-3">
          {hasTarget && (
            <fieldset className="space-y-1.5">
              <legend className="sr-only">The aim</legend>
              {(
                [
                  ["keep", "Keep it"],
                  ["change", "Change it"],
                  ["reached", "Reached it"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name={field("aim")}
                    value={value}
                    checked={draft.aim === value}
                    onChange={() => update({ aim: value })}
                    className="h-4 w-4 accent-accent"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {(!hasTarget || draft.aim === "change") && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <FieldLabel htmlFor={field("target-text")}>The next target</FieldLabel>
                <Input
                  id={field("target-text")}
                  value={draft.targetText}
                  maxLength={TOOL_TEXT_MAX.text}
                  onChange={(e) => update({ targetText: e.target.value })}
                />
              </div>
              <div className="min-w-0">
                <FieldLabel htmlFor={field("target-value")}>Target number</FieldLabel>
                <Input
                  id={field("target-value")}
                  inputMode="decimal"
                  value={draft.targetValue}
                  onChange={(e) => update({ targetValue: e.target.value })}
                />
              </div>
              <div className="min-w-0">
                <FieldLabel htmlFor={field("target-date")}>Target day</FieldLabel>
                <Input
                  id={field("target-date")}
                  type="date"
                  value={draft.targetDate}
                  onChange={(e) => update({ targetDate: e.target.value })}
                />
              </div>
            </div>
          )}
          {draft.aim === "reached" && hasTarget && (
            <p className="text-sm text-sub">
              It joins the past targets when you finish; set the next one after.
            </p>
          )}
        </div>
      )}

      {step.id === "obstacle" && (
        <fieldset className="space-y-1.5">
          <legend className="sr-only">The obstacle you’re on</legend>
          {item.obstacles
            .filter((o) => o.status !== "cleared")
            .map((o) => (
              <label key={o.id} className="flex min-h-11 items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name={field("obstacle")}
                  value={o.id}
                  checked={draft.obstacle === o.id}
                  onChange={() => update({ obstacle: o.id })}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 break-words">{short(o.text, 120)}</span>
              </label>
            ))}
          <label className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input
              type="radio"
              name={field("obstacle")}
              value="new"
              checked={draft.obstacle === "new"}
              onChange={() => update({ obstacle: "new" })}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            Something else
          </label>
          {draft.obstacle === "new" && (
            <div className="pl-6">
              <FieldLabel htmlFor={field("new-obstacle")}>The new obstacle</FieldLabel>
              <Input
                id={field("new-obstacle")}
                value={draft.newObstacle}
                maxLength={TOOL_TEXT_MAX.text}
                onChange={(e) => update({ newObstacle: e.target.value })}
              />
            </div>
          )}
        </fieldset>
      )}

      {step.id === "next-try" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <FieldLabel htmlFor={field("try")}>What you’ll try next</FieldLabel>
            <Textarea
              id={field("try")}
              rows={2}
              value={draft.tryText}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => update({ tryText: e.target.value })}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel htmlFor={field("expect")}>What you think will happen</FieldLabel>
            <Textarea
              id={field("expect")}
              rows={2}
              value={draft.tryExpect}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => update({ tryExpect: e.target.value })}
            />
          </div>
        </div>
      )}

      {step.id === "next-look" && (
        <div className="max-w-xs">
          <FieldLabel htmlFor={field("next-look")}>Next coaching talk</FieldLabel>
          <Input
            id={field("next-look")}
            type="date"
            min={today}
            value={draft.nextLook}
            onChange={(e) => update({ nextLook: e.target.value })}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {at > 0 && (
          <Button type="button" variant="outline" onClick={() => go(at - 1)} className="gap-1.5">
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
        )}
        {last ? (
          <Button type="button" onClick={save} className="gap-1.5">
            <Check aria-hidden="true" />
            Finish
          </Button>
        ) : (
          <Button type="button" onClick={() => go(at + 1)} className="gap-1.5">
            Next
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
        {!last && (
          <Button type="button" variant="ghost" onClick={save} className="gap-1.5">
            <Save aria-hidden="true" />
            Save and stop
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => onClose(false)}
          className="gap-1.5 text-sub"
        >
          <X aria-hidden="true" />
          Leave without saving
        </Button>
      </div>
    </section>
  );
}
