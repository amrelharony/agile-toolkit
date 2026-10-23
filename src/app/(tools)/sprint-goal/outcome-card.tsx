"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { Sprint, SprintGoalOutcome } from "@/lib/stores/workspace-types";
import { focusSoon } from "./focus";
import {
  EMPTY_OUTCOME_DRAFT,
  GOAL_OUTCOMES,
  GOAL_OUTCOME_LABEL,
  GOAL_OUTCOME_MEANING,
  OUTCOME_NOTE_MAX,
  draftFromOutcome,
  outcomeDate,
  outcomePrompt,
  validateOutcome,
  type GoalMet,
  type OutcomeDraft,
  type OutcomeMoment,
  type OutcomeValues,
} from "./outcome";

const QUESTION = "Did we meet the sprint goal?";

const ICON: Record<GoalMet, { icon: typeof CheckCircle2; tone: string }> = {
  met: { icon: CheckCircle2, tone: "text-success" },
  partly: { icon: MinusCircle, tone: "text-warning" },
  "not-met": { icon: XCircle, tone: "text-danger" },
};

/**
 * The three answers as a radio group. There is no default: the wrapper
 * carries `data-scale-invalid`, so saving without an answer focuses the
 * group like a ScalePicker.
 */
function AnswerPicker({
  value,
  onChange,
  error,
}: {
  value: GoalMet | null;
  onChange: (met: GoalMet) => void;
  error?: string;
}) {
  const errorId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  // ToggleGroup takes no ARIA props, so mark its radio group required and
  // link the message here, as the Walking Skeleton's layer picker does.
  // Not aria-invalid: focusFirstInvalid would then pick the group itself,
  // which can't take focus, instead of its radio.
  useEffect(() => {
    const group = wrapRef.current?.querySelector('[role="radiogroup"]');
    if (!group) return;
    group.setAttribute("aria-required", "true");
    if (error) group.setAttribute("aria-describedby", errorId);
    else group.removeAttribute("aria-describedby");
  }, [error, errorId]);

  return (
    <div
      ref={wrapRef}
      className="flex min-w-0 flex-col gap-1.5"
      data-scale-invalid={error ? "true" : undefined}
    >
      {/* The radio group carries the question as its name; this is the visible label. */}
      <span className="text-sm text-text" aria-hidden="true">
        Answer
        <span className="ml-0.5 text-danger">*</span>
      </span>
      <ToggleGroup
        label={QUESTION}
        options={GOAL_OUTCOMES.map((met) => ({
          value: met,
          label: GOAL_OUTCOME_LABEL[met],
          description: GOAL_OUTCOME_MEANING[met],
        }))}
        value={value}
        onValueChange={onChange}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Did we meet the sprint goal?" for the sprint on screen. It asks once
 * the sprint is in its last day or over (and has a goal to answer for),
 * keeps a draft until Save, then shows the recorded answer with Change and
 * Clear. An answer recorded earlier (an agent can record one at any time)
 * shows whatever the date. Renders nothing otherwise.
 */
export function OutcomeCard({
  sprint,
  moment,
  hasGoal,
  outcome,
  onSave,
  onClear,
}: {
  sprint: Sprint;
  /** Why to ask now; null while the sprint still runs. */
  moment: OutcomeMoment | null;
  /** Whether the sprint has a goal statement to answer for. */
  hasGoal: boolean;
  /** The recorded answer, already checked (normalizeGoal). */
  outcome: SprintGoalOutcome | undefined;
  onSave: (values: OutcomeValues) => void;
  onClear: () => void;
}) {
  const headingId = useId();
  const [changing, setChanging] = useState(false);
  const formRoot = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const form = useItemForm<OutcomeDraft, OutcomeValues, keyof OutcomeDraft>({
    initial: EMPTY_OUTCOME_DRAFT,
    validate: validateOutcome,
    onSave: (values) => {
      onSave(values);
      setChanging(false);
      // The form goes with the Save pressed: land on the answer it recorded.
      focusSoon(() => resultRef.current);
    },
  });

  const asking = !outcome && Boolean(moment) && hasGoal;
  if (!outcome && !asking) return null;
  // Only an answer that is still there can be changed (an agent or another
  // tab may have cleared it meanwhile); otherwise this is the first answer.
  const isChange = changing && Boolean(outcome);

  const startChange = () => {
    if (!outcome) return;
    form.reset(draftFromOutcome(outcome));
    setChanging(true);
    focusSoon(() => formRoot.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]'));
  };
  const cancelChange = () => {
    form.reset();
    setChanging(false);
    focusSoon(() => changeRef.current);
  };

  const shell = "mb-4 rounded-lg border border-border bg-card p-4 text-sm";

  if (outcome && !changing) {
    const { icon: Icon, tone } = ICON[outcome.met];
    const date = outcomeDate(outcome);
    return (
      <section aria-labelledby={headingId} className={shell}>
        <h2 id={headingId} className="font-semibold text-text">
          {QUESTION}
        </h2>
        <p
          ref={resultRef}
          tabIndex={-1}
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-text focus:outline-none"
        >
          <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
          <span className="font-medium">{GOAL_OUTCOME_LABEL[outcome.met]}</span>
          {date && <span className="text-xs text-sub">Recorded {date}</span>}
        </p>
        {outcome.note && <p className="mt-1 break-words text-sub">{outcome.note}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button ref={changeRef} type="button" size="sm" variant="outline" onClick={startChange}>
            Change
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear answer
          </Button>
        </div>
      </section>
    );
  }

  const recordedOn = outcome ? outcomeDate(outcome) : null;
  return (
    <section aria-labelledby={headingId} className={shell}>
      <h2 id={headingId} className="font-semibold text-text">
        {QUESTION}
      </h2>
      <p className="mt-1 text-sub">
        {isChange
          ? `Saving replaces the answer recorded${recordedOn ? ` on ${recordedOn}` : ""}.`
          : outcomePrompt(moment, sprint.name)}
      </p>
      <div ref={formRoot}>
        <ItemForm
          form={form}
          submitLabel="Save answer"
          onCancel={isChange ? cancelChange : undefined}
          className="mt-3"
        >
          <AnswerPicker
            value={form.draft.met}
            onChange={(met) => form.update({ met })}
            error={form.errors.met}
          />
          <Field
            label="Note"
            hint="Optional. What made the difference, in a line."
            error={form.errors.note}
          >
            {(control) => (
              <Input
                {...control}
                value={form.draft.note}
                onChange={(e) => form.update({ note: e.target.value })}
                maxLength={OUTCOME_NOTE_MAX}
                placeholder="e.g., Size filters shipped; colour filters moved to the next sprint"
              />
            )}
          </Field>
        </ItemForm>
      </div>
    </section>
  );
}
