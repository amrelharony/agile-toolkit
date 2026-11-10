"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useItemForm } from "@/components/shared/item-form";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { lastBackupText } from "@/lib/data/backup-meta";
import { downloadBackup } from "@/lib/data/download-backup";
import { useLastBackupAt } from "@/lib/data/use-last-backup";
import { useFlash } from "@/hooks/use-flash";
import { unansweredGoal } from "@/app/(tools)/sprint-goal/doc";
import {
  EMPTY_OUTCOME_DRAFT,
  GOAL_OUTCOMES,
  GOAL_OUTCOME_LABEL,
  GOAL_OUTCOME_MEANING,
  OUTCOME_NOTE_MAX,
  validateOutcome,
  type OutcomeDraft,
  type OutcomeValues,
} from "@/app/(tools)/sprint-goal/outcome";
import {
  fmt,
  points as pointsText,
  sprintDates,
  suggestedCompletedPoints,
} from "@/lib/sprints/hub-view";
import { carryOver, storyProgress } from "@/lib/sprints/progress";
import { storyPoints } from "@/lib/sprints/plan";
import { isExampleSprintId } from "@/lib/sprints/example";
import { endDateFor, hasSyntheticDates, sprintLengthDays, todayIso } from "@/lib/sprints/series";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";
import { nextSprintName } from "./sprint-picker";

/** Where a closing sprint's unfinished stories go. */
export type CarryOverTarget = "next" | "backlog" | "later";

export interface CarryOverPlan {
  target: CarryOverTarget;
  /** The unfinished stories, as the dialog listed them. */
  stories: Story[];
  /** "next": the sprint they move into; absent when `newSprint` is to be created. */
  nextSprint?: Sprint;
  /** "next" with no sprint after this one: the sprint to create for them. */
  newSprint?: Omit<Sprint, "id">;
}

/**
 * The sprint after `sprint`: the earliest planned or active one that starts
 * on or after it (any open one when this sprint has no real dates). The
 * example's preview sprints never count.
 */
export function nextSprintAfter(sprint: Sprint, sprints: readonly Sprint[]): Sprint | undefined {
  const dated = !hasSyntheticDates(sprint);
  return sprints
    .filter(
      (s) =>
        s.id !== sprint.id &&
        (s.status === "planned" || s.status === "active") &&
        !isExampleSprintId(s.id) &&
        (!dated || (!hasSyntheticDates(s) && s.startDate >= sprint.startDate))
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

/**
 * The sprint "Next sprint" creates when there is none yet: named after the
 * last "Sprint N", starting the day after this one ends (today when it has
 * no dates), planned with nothing committed (Sprint Planning commits it).
 */
export function newSprintAfter(
  sprint: Sprint,
  sprints: readonly Sprint[],
  lengthDays: number = sprintLengthDays(sprint),
  today: string = todayIso()
): Omit<Sprint, "id"> {
  const startDate = hasSyntheticDates(sprint) ? today : endDateFor(sprint.endDate, 1);
  return {
    name: nextSprintName(sprints),
    startDate,
    endDate: endDateFor(startDate, lengthDays),
    pointsPlanned: 0,
    status: "planned",
  };
}

const STORY_STATUS: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

interface CloseDraft {
  points: string;
  carry: CarryOverTarget | "";
}

interface CloseValues {
  points: number;
  carry: CarryOverTarget | null;
}

export interface CloseSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: Sprint;
  series: SprintSeries | undefined;
  /** "close": mark it done with its points. "points": only add the missing points. */
  mode: "close" | "points";
  /**
   * The shared stories. When closing, the sprint's unfinished ones are
   * listed and the user picks where they go; leave out to skip that step.
   */
  stories?: readonly Story[];
  /** Every sprint, to find (or name) the next one. */
  sprints?: readonly Sprint[];
  /** Length in days of a next sprint created here; defaults to this sprint's. */
  nextLengthDays?: number;
  /** `carryOver` is set when the sprint had unfinished stories and `stories` was given. */
  onConfirm: (pointsCompleted: number, carryOver?: CarryOverPlan) => void;
  /**
   * Record the answer to "Did we meet the sprint goal?" as part of the close
   * `onConfirm` just made, so the close's one Undo takes it back too
   * (ClosedSprint.answerGoal). Without it the finished step doesn't ask.
   */
  onGoalOutcome?: (values: OutcomeValues) => void;
}

const GOAL_QUESTION = "Did we meet the sprint goal?";

/**
 * What the dialog shows once the sprint is closed, in place of the form:
 * that it is closed, the goal question when the sprint has a goal and no
 * answer yet, and a backup download. Both are optional and neither is a
 * toast: the answer is saved by the step's own button, the download
 * confirms itself on its button. An answer picked here is recorded through
 * `onGoalOutcome`, under the close's Undo.
 */
function ClosedStep({
  sprint,
  onGoalOutcome,
  onDone,
}: {
  sprint: Sprint;
  onGoalOutcome?: (values: OutcomeValues) => void;
  onDone: () => void;
}) {
  const goals = useWorkspaceStore((s) => s.sprintGoals);
  // Asked once, as the step opens: the goal as it stood then.
  const [goal] = useState(() => (onGoalOutcome ? unansweredGoal(goals, sprint) : null));
  const [draft, setDraft] = useState<OutcomeDraft>(EMPTY_OUTCOME_DRAFT);
  const [noteError, setNoteError] = useState<string | undefined>();
  const lastBackup = useLastBackupAt();
  const { flash, isFlashing } = useFlash();
  const downloaded = isFlashing();
  const title = useRef<HTMLHeadingElement>(null);
  const questionId = useId();
  const backupId = useId();
  const backupNoteId = useId();

  // The form (and the button just pressed) went with the close: land on
  // what replaced it.
  useEffect(() => {
    title.current?.focus();
  }, []);

  const answering = goal !== null && draft.met !== null;
  const finish = () => {
    if (answering) {
      const check = validateOutcome(draft);
      if (!check.ok) {
        setNoteError(check.errors.note);
        return;
      }
      onGoalOutcome?.(check.values);
    }
    onDone();
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        finish();
      }}
    >
      <DialogHeader>
        <DialogTitle ref={title} tabIndex={-1} className="outline-none">
          {sprint.name} is closed
        </DialogTitle>
        <DialogDescription>
          {pointsText(sprint.pointsCompleted ?? 0)} done of {fmt(sprint.pointsPlanned)} committed.
          Velocity, Release Planner and the dashboard now count it.
        </DialogDescription>
      </DialogHeader>

      {goal !== null && (
        <section aria-labelledby={questionId} className="space-y-2">
          <h3 id={questionId} className="text-sm font-semibold text-text">
            {GOAL_QUESTION}
          </h3>
          <p className="break-words text-sm text-sub">“{goal}”</p>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              label={GOAL_QUESTION}
              options={GOAL_OUTCOMES.map((met) => ({
                value: met,
                label: GOAL_OUTCOME_LABEL[met],
                description: GOAL_OUTCOME_MEANING[met],
              }))}
              value={draft.met}
              onValueChange={(met) => setDraft((d) => ({ ...d, met }))}
            />
            {draft.met !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(EMPTY_OUTCOME_DRAFT);
                  setNoteError(undefined);
                }}
              >
                Clear answer
              </Button>
            )}
          </div>
          {draft.met !== null && (
            <Field
              label="Note"
              hint="Optional. What made the difference, in a line."
              error={noteError}
            >
              {(control) => (
                <Input
                  {...control}
                  value={draft.note}
                  maxLength={OUTCOME_NOTE_MAX}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, note: e.target.value }));
                    setNoteError(undefined);
                  }}
                />
              )}
            </Field>
          )}
          <p className="text-xs text-sub">
            Optional. The Sprint Review and the retro read the answer, and you can give or change it
            later in Sprint Goal.
          </p>
        </section>
      )}

      <section aria-labelledby={backupId} className="space-y-2">
        <h3 id={backupId} className="text-sm font-semibold text-text">
          Keep a copy
        </h3>
        <p id={backupNoteId} className="text-sm text-sub">
          A backup file holds every sprint, retro and action in this browser as it is now. Nothing
          is backed up on its own.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            aria-describedby={backupNoteId}
            onClick={() => flash(`Backup downloaded: ${downloadBackup()} items saved.`)}
          >
            {downloaded ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
            {downloaded ? "Backup downloaded" : "Download backup"}
          </Button>
          <span className="text-xs text-sub" data-field="last-backup">
            {lastBackupText(lastBackup)}
          </span>
        </div>
      </section>

      <DialogFooter>
        <Button type="submit">{answering ? "Save answer and close" : "Done"}</Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Close a sprint: it becomes "Done" with the points the team finished,
 * suggested from the sprint board (or the daily log) and editable first.
 * Stories it leaves unfinished are listed, and nothing happens to them
 * until the user says where they go: into the next sprint (created here if
 * there is none), back to the backlog, or left for Sprint Planning.
 *
 * Closing doesn't shut the dialog: it ends on one finished step
 * (ClosedStep) that asks the goal question when it is still open and offers
 * a backup. "points" mode only adds points and closes on save, as before.
 */
export function CloseSprintDialog({
  open,
  onOpenChange,
  sprint,
  series,
  mode,
  stories,
  sprints = [],
  nextLengthDays,
  onConfirm,
  onGoalOutcome,
}: CloseSprintDialogProps) {
  const closing = mode === "close";
  const groupId = useId();
  // "form" until the sprint is closed, then the finished step.
  const [step, setStep] = useState<"form" | "closed">("form");
  const progress = useMemo(
    () => (stories ? storyProgress(stories, sprint.id) : null),
    [stories, sprint.id]
  );
  const left = useMemo(
    () => (closing && stories ? carryOver(sprint, stories) : null),
    [closing, stories, sprint]
  );
  const unfinished = left?.stories ?? [];
  const next = useMemo(() => nextSprintAfter(sprint, sprints), [sprint, sprints]);
  const created = useMemo(
    () => (next ? null : newSprintAfter(sprint, sprints, nextLengthDays)),
    [next, sprint, sprints, nextLengthDays]
  );

  // The board's done points when it has pointed stories, else the log's.
  const fromBoard = progress !== null && progress.scope > 0;
  const logged = suggestedCompletedPoints(sprint, series);
  const suggestion = fromBoard ? progress.done : logged.points;
  const hint = fromBoard
    ? `From the sprint board: the done stories add up to ${pointsText(progress.done)}. Change it if it's wrong.`
    : logged.fromDay !== null
      ? `Suggested from day ${logged.fromDay} of the daily log. Change it if it's wrong.`
      : "Nothing is logged yet, so enter what the team finished.";

  const validate = (draft: CloseDraft): Validation<CloseValues, keyof CloseDraft> => {
    const errors: FormErrors<keyof CloseDraft> = {};
    const n = parseNumber(draft.points);
    if (n === undefined || !Number.isFinite(n) || n < 0) errors.points = "Enter 0 or more points.";
    if (unfinished.length > 0 && !draft.carry) {
      errors.carry = `Choose where the unfinished ${unfinished.length === 1 ? "story goes" : "stories go"}.`;
    }
    if (errors.points || errors.carry) return { ok: false, errors };
    return { ok: true, values: { points: n as number, carry: draft.carry || null } };
  };

  const form = useItemForm<CloseDraft, CloseValues, keyof CloseDraft>({
    initial: { points: "", carry: "" },
    validate,
    resetOnSave: false,
    onSave: ({ points, carry }) => {
      const plan: CarryOverPlan | undefined =
        carry && unfinished.length > 0
          ? {
              target: carry,
              stories: unfinished,
              ...(carry === "next" && next ? { nextSprint: next } : {}),
              ...(carry === "next" && !next && created ? { newSprint: created } : {}),
            }
          : undefined;
      onConfirm(points, plan);
      // Closing a sprint ends on the finished step; adding points just closes.
      if (closing) setStep("closed");
      else onOpenChange(false);
    },
  });

  // A fresh suggestion, and no choice, each time it opens.
  useEffect(() => {
    if (!open) return;
    setStep("form");
    form.reset({ points: suggestion === null ? "" : fmt(suggestion), carry: "" });
    // Only on opening: the suggestion must not overwrite what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The finished step is about a closed sprint. If the close didn't happen
  // (the sprint was gone) or was undone while the step is up, there is
  // nothing left to say: the dialog goes.
  const closed = sprint.status === "completed";
  useEffect(() => {
    if (open && step === "closed" && !closed) onOpenChange(false);
  }, [open, step, closed, onOpenChange]);

  // A radio can't be marked aria-invalid, so the form's own focus-the-first-
  // invalid-field can't find a missing choice: focus it here. A bad number
  // comes first and is focused by the form.
  const firstChoice = useRef<HTMLInputElement>(null);
  const submit = (e: React.FormEvent) => {
    if (form.submit(e)) return;
    const check = validate(form.draft);
    if (!check.ok && check.errors.carry && !check.errors.points) firstChoice.current?.focus();
  };

  const carryError = form.errors.carry;
  const createdDates = created ? sprintDates({ ...created, id: "" }) : null;
  const options: { value: CarryOverTarget; label: string; detail: string }[] = [
    next
      ? {
          value: "next",
          label: `Into ${next.name}`,
          detail: "They keep their status. Plan around them in Sprint Planning.",
        }
      : {
          value: "next",
          label: `Into a new sprint, ${created?.name ?? "the next one"}`,
          detail: `There's no next sprint yet: this creates ${created?.name ?? "it"}${
            createdDates ? ` (${createdDates})` : ""
          } and moves them there.`,
        },
    {
      value: "backlog",
      label: "Back to the backlog",
      detail: "They leave the sprint and wait in the backlog, to be planned again.",
    },
    {
      value: "later",
      label: "Decide later in Sprint Planning",
      detail: `They stay with ${sprint.name}; Sprint Planning lists them as left over from it.`,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {step === "closed" && closed ? (
          <ClosedStep
            sprint={sprint}
            onGoalOutcome={onGoalOutcome}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <form ref={form.formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{closing ? `Close ${sprint.name}` : "Add completed points"}</DialogTitle>
              <DialogDescription>
                {closing
                  ? "The sprint is marked done. Velocity, Release Planner and the dashboard use its completed points."
                  : "Velocity and forecasts skip a finished sprint until it has completed points."}
              </DialogDescription>
            </DialogHeader>
            <Field label="Completed points" required hint={hint} error={form.errors.points}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.draft.points}
                  onChange={(e) => form.update({ points: e.target.value })}
                  autoFocus
                />
              )}
            </Field>
            <p className="text-xs text-sub">Committed: {fmt(sprint.pointsPlanned)} points.</p>

            {unfinished.length > 0 && (
              <fieldset
                className="min-w-0 space-y-2"
                aria-describedby={carryError ? `${groupId}-error` : undefined}
              >
                <legend className="mb-2 text-sm font-medium text-text">
                  {unfinished.length === 1
                    ? "Where does the unfinished story go?"
                    : `Where do the ${unfinished.length} unfinished stories go?`}
                </legend>
                <ul
                  aria-label="Unfinished stories"
                  className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border"
                >
                  {unfinished.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 break-words text-sm text-text">{s.title}</span>
                      <span className="shrink-0 text-xs text-sub">
                        {typeof s.points === "number" ? pointsText(storyPoints(s)) : "No points"}
                        {" · "}
                        {STORY_STATUS[s.status] ?? s.status}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-sub">
                  {pointsText(left?.points ?? 0)} unfinished. Nothing moves until you choose.
                </p>
                <div className="space-y-1.5">
                  {options.map((o, i) => {
                    const id = `${groupId}-${o.value}`;
                    const checked = form.draft.carry === o.value;
                    return (
                      <div
                        key={o.value}
                        className={cn(
                          "flex items-start gap-2 rounded-md border px-3 py-2",
                          checked ? "border-accent bg-accent/10" : "border-border"
                        )}
                      >
                        <input
                          ref={i === 0 ? firstChoice : undefined}
                          id={id}
                          type="radio"
                          name={`${groupId}-carry`}
                          value={o.value}
                          checked={checked}
                          onChange={() => form.update({ carry: o.value })}
                          aria-describedby={`${id}-detail`}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <div className="min-w-0">
                          <label
                            htmlFor={id}
                            className="block cursor-pointer text-sm font-medium text-text"
                          >
                            {o.label}
                          </label>
                          <p id={`${id}-detail`} className="text-xs text-sub">
                            {o.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {carryError && (
                  <p id={`${groupId}-error`} role="alert" className="text-xs text-danger">
                    {carryError}
                  </p>
                )}
              </fieldset>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">{closing ? "Close sprint" : "Save points"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
