"use client";

/**
 * The fields Improve's views share: a native select styled like <Input>
 * (a phone's own picker), a person's name saved when the field is left, a
 * day saved the same way, and a condition (where things are, or where the
 * team wants them) edited field by field.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { PersonPicker } from "@/components/team/person-picker";
import {
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_UNIT_MAX,
  TOOL_TEXT_MAX,
  type ImprovementCondition,
  type ImprovementStatus,
} from "@/lib/stores/workspace-types";
import { STATUS_LABEL, isDay } from "@/lib/improve/model";
import { cn } from "@/lib/utils";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** A small label above a field. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-sub">
      {children}
    </label>
  );
}

/**
 * A one-line box that can't be left blank (a title, a step's or an
 * obstacle's words), saved when it is left. Left blank, nothing is saved:
 * the box shows the saved words again and `onBlank` says why in place.
 */
export function RequiredBlurInput({
  onCommit,
  onBlank,
  ...props
}: {
  id: string;
  value: string;
  maxLength?: number;
  className?: string;
  "aria-describedby"?: string;
  onCommit: (next: string) => void;
  onBlank: () => void;
}) {
  // A new round puts the saved words back (the box keeps its own draft).
  const [round, setRound] = useState(0);
  return (
    <BlurInput
      key={round}
      {...props}
      onCommit={(next) => {
        if (next.trim()) {
          onCommit(next);
          return;
        }
        setRound((r) => r + 1);
        onBlank();
      }}
    />
  );
}

/** Why a typed day can't be saved, or null (blank clears it). */
export function dayProblem(day: string): string | null {
  if (day === "") return null;
  return isDay(day) ? null : "Give the date as a real day.";
}

/**
 * A person picked from the roster, saved when the field is left rather than
 * on each key (the record is synced): the name as typed, or "" for nobody.
 */
export function PersonField({
  label,
  value,
  onCommit,
  hideLabel,
  className,
}: {
  label: string;
  value: string;
  onCommit: (name: string) => void;
  hideLabel?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const box = useRef<HTMLDivElement>(null);
  // Saved when focus leaves the field (its input or "Add to the team").
  const commit = useRef(() => {});
  commit.current = () => {
    const clean = draft.replace(/\s+/g, " ").trim().slice(0, TOOL_TEXT_MAX.short);
    if (clean !== value) onCommit(clean);
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onLeave = () => commit.current();
    el.addEventListener("focusout", onLeave);
    return () => el.removeEventListener("focusout", onLeave);
  }, []);
  return (
    <div ref={box} className={cn("min-w-0", className)}>
      <PersonPicker
        label={label}
        hideLabel={hideLabel}
        value={draft}
        onChange={(name) => setDraft(name.slice(0, TOOL_TEXT_MAX.short))}
        placeholder="Nobody yet"
      />
    </div>
  );
}

/** The improvement's status: open, being checked, closed or dropped. */
export function ItemStatusSelect({
  value,
  onChange,
  className,
}: {
  value: ImprovementStatus;
  onChange: (status: ImprovementStatus) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 max-w-xs", className)}>
      <label htmlFor={id} className="mb-1 block text-sm text-text">
        Improvement status
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as ImprovementStatus)}
        className={SELECT_CLASS}
      >
        {IMPROVEMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A number typed into a box: undefined when blank, NaN when it isn't one. */
export function parseValue(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".");
  if (!t) return undefined;
  return Number(t);
}

/**
 * Where things are (`current`) or where the team wants them (`target`):
 * words, what is measured, the number and its unit, and the day. Each field
 * saves when it is left; a number that isn't one is refused in place.
 */
export function ConditionFields({
  condition,
  wordsLabel,
  wordsPlaceholder,
  dateLabel,
  onChange,
  disabled,
}: {
  condition: ImprovementCondition;
  wordsLabel: string;
  wordsPlaceholder: string;
  dateLabel: string;
  onChange: (patch: Partial<ImprovementCondition>) => void;
  disabled?: boolean;
}) {
  const ids = useId();
  const [valueError, setValueError] = useState<string | null>(null);
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div>
        <FieldLabel htmlFor={`${ids}-text`}>{wordsLabel}</FieldLabel>
        <BlurTextarea
          id={`${ids}-text`}
          rows={2}
          value={condition.text}
          maxLength={TOOL_TEXT_MAX.text}
          placeholder={wordsPlaceholder}
          onCommit={(text) => onChange({ text })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <FieldLabel htmlFor={`${ids}-metric`}>What you measure</FieldLabel>
          <BlurInput
            id={`${ids}-metric`}
            value={condition.metric ?? ""}
            maxLength={TOOL_TEXT_MAX.short}
            placeholder="Days from merge to release"
            onCommit={(metric) => onChange({ metric })}
          />
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor={`${ids}-value`}>Number</FieldLabel>
          <BlurInput
            id={`${ids}-value`}
            inputMode="decimal"
            value={condition.value === undefined ? "" : String(condition.value)}
            aria-describedby={valueError ? `${ids}-value-error` : undefined}
            onCommit={(raw) => {
              const n = parseValue(raw);
              if (n !== undefined && !Number.isFinite(n)) {
                setValueError("Give a number, such as 6 or 1.5.");
                return;
              }
              setValueError(null);
              onChange({ value: n });
            }}
          />
          {valueError && (
            <p id={`${ids}-value-error`} role="alert" className="mt-1 text-xs text-danger">
              {valueError}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor={`${ids}-unit`}>Unit</FieldLabel>
          <BlurInput
            id={`${ids}-unit`}
            value={condition.unit ?? ""}
            maxLength={IMPROVEMENT_UNIT_MAX}
            placeholder="days"
            onCommit={(unit) => onChange({ unit })}
          />
        </div>
      </div>
      <div className="max-w-xs">
        <p className="mb-1 text-xs font-medium text-sub" aria-hidden="true">
          {dateLabel}
        </p>
        <DayInput
          label={dateLabel}
          value={condition.date ?? ""}
          validate={dayProblem}
          onCommit={(date) => onChange({ date: date || undefined })}
        />
      </div>
    </fieldset>
  );
}
