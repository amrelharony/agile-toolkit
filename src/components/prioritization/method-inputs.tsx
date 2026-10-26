"use client";

/**
 * A prioritization method's inputs as form controls, from the method
 * registry's own definition (lib/prioritization/methods): each scale is a
 * ScalePicker with its meanings and a Clear, a number a labelled input, a
 * choice a segmented control, a date a date input and a person the roster
 * PersonPicker. Nothing starts filled in: an unset input is blank until
 * picked, and an off-scale value a row already held stays on offer as
 * "Custom".
 *
 * The method tools' add and edit forms (MethodTool) and the hub's row
 * editor use it, so the same input reads the same everywhere.
 */

import { useEffect, useId, useRef } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ScalePicker } from "@/components/shared/scale-picker";
import { PersonPicker } from "@/components/team/person-picker";
import { cn } from "@/lib/utils";
import type { FormErrors } from "@/lib/utils/form";
import { toNumber } from "@/lib/prioritization/methods/fields";
import type { MethodInput, PrioritizationMethod, Values } from "@/lib/prioritization/methods";

export interface MethodInputsProps {
  method: PrioritizationMethod;
  /** The draft, by input key; undefined = not set. Number inputs hold what was typed. */
  draft: Values;
  update: (patch: Values) => void;
  errors: FormErrors<string>;
  /** Off-scale values the stored row held, kept on offer as "Custom". */
  custom?: Values;
  size?: "sm" | "md";
  /** Only these inputs, in this order (default: every input of the method). */
  only?: readonly string[];
  /** Leave these inputs out (e.g. ones the tool renders itself). */
  hide?: readonly string[];
  /** Labels to use instead of the method's (a tool's own wording). */
  labels?: Readonly<Record<string, string>>;
  className?: string;
}

const formatFor = (input: MethodInput): ((v: number) => string) =>
  input.kind === "scale" && input.format === "pct"
    ? (v) => `${v}%`
    : input.kind === "scale" && input.format === "x"
      ? (v) => `${v}x`
      : String;

/** The inputs to render, in order. */
function shown(method: PrioritizationMethod, only?: readonly string[], hide?: readonly string[]) {
  const byKey = new Map(method.inputs.map((i) => [i.key, i]));
  const list = only
    ? only.map((k) => byKey.get(k)).filter((i): i is MethodInput => !!i)
    : method.inputs;
  return hide ? list.filter((i) => !hide.includes(i.key)) : list;
}

export function MethodInputs({
  method,
  draft,
  update,
  errors,
  custom,
  size = "md",
  only,
  hide,
  labels,
  className,
}: MethodInputsProps) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", className)}>
      {shown(method, only, hide).map((input) => (
        <MethodInputControl
          key={input.key}
          input={input}
          label={labels?.[input.key] ?? input.label}
          value={draft[input.key]}
          custom={custom?.[input.key]}
          error={errors[input.key]}
          size={size}
          onChange={(v) => update({ [input.key]: v })}
        />
      ))}
    </div>
  );
}

/** One input as its control. */
export function MethodInputControl({
  input,
  label = input.label,
  value,
  custom,
  error,
  size = "md",
  onChange,
}: {
  input: MethodInput;
  label?: string;
  value: number | string | undefined;
  custom?: number | string | undefined;
  error?: string;
  size?: "sm" | "md";
  onChange: (value: number | string | undefined) => void;
}) {
  switch (input.kind) {
    case "scale":
      return (
        <ScalePicker
          label={label}
          steps={input.steps}
          value={toNumber(value) ?? null}
          custom={toNumber(custom) ?? null}
          format={formatFor(input)}
          onValueChange={(v) => onChange(v)}
          onClear={() => onChange(undefined)}
          hint={input.hint}
          error={error}
          size={size}
          // Long scales wrap as even rows on a phone, one row from 640 px.
          optionsClassName={input.steps.length > 7 ? "grid grid-cols-5 sm:inline-flex" : undefined}
        />
      );
    case "number":
      return (
        <Field
          label={input.unit ? `${label} (${input.unit})` : label}
          hint={input.hint}
          error={error}
          required={!input.optional}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min={input.min}
              max={input.max}
              step={input.step ?? "any"}
              value={value === undefined ? "" : String(value)}
              onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
            />
          )}
        </Field>
      );
    case "choice":
      return (
        <ChoiceControl
          label={label}
          hint={input.hint}
          error={error}
          size={size}
          required={!input.optional}
          options={input.options}
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
        />
      );
    case "date":
      return (
        <Field label={label} hint={input.hint} error={error} required={!input.optional}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value || undefined)}
            />
          )}
        </Field>
      );
    case "person":
      return (
        <PersonPicker
          label={label}
          hint={input.hint}
          error={error}
          required={!input.optional}
          value={typeof value === "string" ? value : ""}
          onChange={(name) => onChange(name.trim() ? name : undefined)}
        />
      );
  }
}

/**
 * A choice input: a segmented control with its label, hint, error and a
 * Clear. A required one shows Field's marker by its label and is
 * aria-required, as a Field's control is.
 */
function ChoiceControl({
  label,
  hint,
  error,
  size,
  required = false,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  error?: string;
  size: "sm" | "md";
  required?: boolean;
  options: readonly { id: string; label: string; meaning?: string }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  // ToggleGroup has no aria-required of its own, so its radio group gets
  // it here (the group element stays the same one across renders).
  useEffect(() => {
    const group = rootRef.current?.querySelector('[role="radiogroup"]');
    if (required) group?.setAttribute("aria-required", "true");
    else group?.removeAttribute("aria-required");
  }, [required]);
  return (
    <div
      ref={rootRef}
      className="flex min-w-0 flex-col gap-1.5"
      data-scale-invalid={error ? "true" : undefined}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        {/* The radio group carries the same name; this is the visible label. */}
        <span className="text-sm text-text" aria-hidden="true">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </span>
        {value !== undefined && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label={`Clear ${label}`}
            className="min-touch-coarse rounded text-xs text-sub underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
        )}
      </div>
      <ToggleGroup
        label={label}
        size={size}
        className="flex-wrap"
        options={options.map((o) => ({ value: o.id, label: o.label, description: o.meaning }))}
        value={value ?? null}
        onValueChange={(v) => onChange(v)}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ")}
      />
      <p id={hintId} className="text-xs text-sub">
        {hint}
      </p>
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
