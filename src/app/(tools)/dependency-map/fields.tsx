"use client";

import { useId, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Form controls the dependency tools share (Dependency Map, PI Planning,
 * Scrum of Scrums): a required choice with no default, a native select, and
 * a team name with suggestions.
 */

/** Matches <Input>: 44 px on phones, 36 px from md. */
export const SELECT_CLASS =
  "flex h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * A choice from a few options, unset until picked (radio semantics, arrow
 * keys). A kind or a commitment is a bucket, so it never defaults: the
 * error says what's missing, and `focusFirstInvalid` lands on the group.
 */
export function ChoiceField<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  required,
  className,
}: {
  label: string;
  options: ToggleOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-scale-invalid={error ? "true" : undefined}
    >
      {/* The radio group carries the same name; this is the visible label. */}
      <span className="text-sm text-text" aria-hidden="true">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <ToggleGroup
        label={label}
        size="sm"
        options={options}
        value={value}
        onValueChange={onChange}
      />
      {hint && <p className="text-xs text-sub">{hint}</p>}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A labelled native select (reliable on phones, and keyboard-native everywhere). */
export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  required,
  hideLabel,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  /** An empty first option ("Choose a team"), for a value that starts unset. */
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      hideLabel={hideLabel}
      className={className}
    >
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * A team name: suggests the teams already in use (as a datalist) and still
 * takes a new one, so a cross-team log keeps one spelling per team without
 * blocking a team that joins this week.
 */
export function TeamField({
  label,
  value,
  onChange,
  teams,
  error,
  hint,
  required,
  placeholder = "e.g. Payments",
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  teams: readonly string[];
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(props) => (
        <>
          <Input
            {...props}
            list={listId}
            autoComplete="off"
            maxLength={120}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <datalist id={listId}>
            {teams.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}

/** Team names, de-duplicated case-insensitively (first spelling wins) and sorted. */
export function uniqueTeams(names: readonly (string | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw?.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
