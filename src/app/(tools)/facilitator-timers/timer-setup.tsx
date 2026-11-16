"use client";

import { useId, useState } from "react";
import { Play, SlidersHorizontal } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import {
  LIMITS,
  TIMER_TITLE,
  lengthText,
  planText,
  type Crazy8sSettings,
  type PomodoroSettings,
  type TimerKind,
} from "@/lib/facilitator-timers/model";
import {
  crazy8sDraft,
  pomodoroDraft,
  validateBreak,
  validateCrazy8s,
  validatePomodoro,
  type BreakDraft,
  type BreakValues,
  type Crazy8sDraft,
  type PomodoroDraft,
} from "./forms";

export interface TimerSetupProps {
  pomodoro: PomodoroSettings;
  crazy8s: Crazy8sSettings;
  breakMinutes: number;
  chime: boolean;
  onChime: (on: boolean) => void;
  /** Why nothing can start now (another timer is on), or null. */
  blocked: string | null;
  onStartPomodoro: (s: PomodoroSettings) => void;
  onStartCrazy8s: (s: Crazy8sSettings) => void;
  onStartBreak: (v: BreakValues) => void;
}

/**
 * Choose a timer and start it: Pomodoro, a break with its return time, or
 * Crazy 8s. Each form checks its values before anything starts; the
 * lengths used are kept for next time.
 */
export function TimerSetup(props: TimerSetupProps) {
  const [kind, setKind] = useState<TimerKind>("pomodoro");
  const chimeId = useId();
  return (
    <SectionCard title="Start a timer" icon={SlidersHorizontal} titleSize="sm">
      <div className="flex flex-col gap-4">
        <ToggleGroup<TimerKind>
          label="Timer"
          options={(["pomodoro", "break", "crazy-8s"] as const).map((k) => ({
            value: k,
            label: TIMER_TITLE[k],
          }))}
          value={kind}
          onValueChange={setKind}
        />
        {kind === "pomodoro" && <PomodoroForm {...props} />}
        {kind === "break" && <BreakForm {...props} />}
        {kind === "crazy-8s" && <Crazy8sForm {...props} />}
        {props.blocked && (
          <p className="text-sm text-warning" role="status">
            {props.blocked}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <Label htmlFor={chimeId} className="text-sm text-text">
            Chime when time is up
          </Label>
          <Switch id={chimeId} checked={props.chime} onCheckedChange={props.onChime} />
        </div>
      </div>
    </SectionCard>
  );
}

function NumberField({
  label,
  hint,
  error,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error} required>
      {(p) => (
        <Input
          {...p}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[8rem] font-data"
        />
      )}
    </Field>
  );
}

function PomodoroForm({ pomodoro, crazy8s, breakMinutes, onStartPomodoro }: TimerSetupProps) {
  const form = useItemForm<PomodoroDraft, PomodoroSettings, keyof PomodoroDraft>({
    initial: () => pomodoroDraft(pomodoro),
    validate: validatePomodoro,
    onSave: (s) => onStartPomodoro(s),
    resetOnSave: false,
  });
  const check = validatePomodoro(form.draft);
  return (
    <ItemForm form={form} submitLabel="Start Pomodoro" submitIcon={<Play aria-hidden="true" />}>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField
          label="Focus minutes"
          error={form.errors.workMinutes}
          value={form.draft.workMinutes}
          {...LIMITS.workMinutes}
          onChange={(workMinutes) => form.update({ workMinutes })}
        />
        <NumberField
          label="Break minutes"
          error={form.errors.breakMinutes}
          value={form.draft.breakMinutes}
          {...LIMITS.breakMinutes}
          onChange={(breakMinutes) => form.update({ breakMinutes })}
        />
        <NumberField
          label="Rounds"
          error={form.errors.rounds}
          value={form.draft.rounds}
          {...LIMITS.rounds}
          onChange={(rounds) => form.update({ rounds })}
        />
      </div>
      <p className="text-xs text-sub">
        {check.ok
          ? `${planText("pomodoro", { pomodoro: check.values, crazy8s, breakMinutes })}. The next block starts by itself.`
          : "Focus blocks with short breaks between them."}
      </p>
    </ItemForm>
  );
}

function Crazy8sForm({ pomodoro, crazy8s, breakMinutes, onStartCrazy8s }: TimerSetupProps) {
  const form = useItemForm<Crazy8sDraft, Crazy8sSettings, keyof Crazy8sDraft>({
    initial: () => crazy8sDraft(crazy8s),
    validate: validateCrazy8s,
    onSave: (s) => onStartCrazy8s(s),
    resetOnSave: false,
  });
  const check = validateCrazy8s(form.draft);
  return (
    <ItemForm form={form} submitLabel="Start Crazy 8s" submitIcon={<Play aria-hidden="true" />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="Sketches"
          error={form.errors.rounds}
          value={form.draft.rounds}
          {...LIMITS.sketchRounds}
          onChange={(rounds) => form.update({ rounds })}
        />
        <NumberField
          label="Seconds per sketch"
          error={form.errors.roundSeconds}
          value={form.draft.roundSeconds}
          {...LIMITS.roundSeconds}
          onChange={(roundSeconds) => form.update({ roundSeconds })}
        />
      </div>
      <p className="text-xs text-sub">
        {check.ok
          ? `${planText("crazy-8s", { pomodoro, crazy8s: check.values, breakMinutes })}. A cue marks each new sketch.`
          : "Fold a sheet into eight panels and sketch one idea in each."}
      </p>
    </ItemForm>
  );
}

function BreakForm({ breakMinutes, onStartBreak }: TimerSetupProps) {
  const form = useItemForm<BreakDraft, BreakValues, "minutes" | "clock">({
    initial: () => ({ mode: "minutes", minutes: String(breakMinutes), clock: "" }),
    validate: (d) => validateBreak(d, Date.now()),
    onSave: (v) => onStartBreak(v),
    resetOnSave: false,
  });
  const { draft } = form;
  return (
    <ItemForm form={form} submitLabel="Start the break" submitIcon={<Play aria-hidden="true" />}>
      <ToggleGroup<BreakDraft["mode"]>
        label="Set the break by"
        size="sm"
        options={[
          { value: "minutes", label: "Minutes" },
          { value: "clock", label: "Time to be back" },
        ]}
        value={draft.mode}
        onValueChange={(mode) => form.update({ mode })}
      />
      {draft.mode === "minutes" ? (
        <NumberField
          label="Break minutes"
          hint={`Up to ${lengthText(LIMITS.breakScreenMinutes.max * 60)}.`}
          error={form.errors.minutes}
          value={draft.minutes}
          {...LIMITS.breakScreenMinutes}
          onChange={(minutes) => form.update({ minutes })}
        />
      ) : (
        <Field
          label="Back at"
          hint="Your local time, such as 10:45."
          error={form.errors.clock}
          required
        >
          {(p) => (
            <Input
              {...p}
              type="time"
              value={draft.clock}
              onChange={(e) => form.update({ clock: e.target.value })}
              className="max-w-[10rem] font-data"
            />
          )}
        </Field>
      )}
      <p className="text-xs text-sub">
        A big “Back at” screen with the countdown, ready to show on the big screen.
      </p>
    </ItemForm>
  );
}
