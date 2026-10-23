"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NumberCheck } from "./validate";
import { validateVelocities } from "./velocity-source";

export const inputCls =
  "bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20";

/**
 * A draft that follows the saved value: it re-syncs when the value changes
 * from outside (Reset, Undo, another tab), not when the field saved it
 * itself — re-syncing then would turn "1." into "1" mid-keystroke.
 */
function useDraft(saved: string): [string, (next: string) => void, (committed: string) => void] {
  const [draft, setDraft] = useState(saved);
  const last = useRef(saved);
  useEffect(() => {
    if (saved !== last.current) {
      last.current = saved;
      setDraft(saved);
    }
  }, [saved]);
  const markSaved = (committed: string) => {
    last.current = committed;
  };
  return [draft, setDraft, markSaved];
}

const show = (n: number | null) => (n === null ? "" : String(n));

/**
 * A number field that saves only valid values: each valid keystroke saves
 * quietly (so the forecast follows the typing), blur or Enter saves with a
 * history entry, and an invalid draft shows its message and saves nothing.
 */
export function NumberField({
  label,
  hint,
  value,
  validate,
  onChange,
  onCommit,
  placeholder,
  suffix,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: number | null;
  validate: NumberCheck;
  /** A valid value while typing. */
  onChange: (value: number | null) => void;
  /** A valid value on blur or Enter. */
  onCommit: (value: number | null) => void;
  placeholder?: string;
  /** A unit after the input ("%", "days"). */
  suffix?: string;
  className?: string;
}) {
  const [draft, setDraft, markSaved] = useDraft(show(value));
  const [error, setError] = useState<string | null>(null);

  const check = (raw: string) => {
    const result = validate(raw);
    setError(result.ok ? null : (result.errors.value ?? null));
    return result;
  };

  return (
    <Field label={label} hint={hint} error={error ?? undefined} className={className}>
      {(props) => (
        <div className="flex items-center gap-2">
          <Input
            {...props}
            type="text"
            inputMode="decimal"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const result = check(raw);
              if (result.ok) {
                markSaved(show(result.values));
                onChange(result.values);
              }
            }}
            onBlur={() => {
              const result = check(draft);
              if (result.ok) {
                markSaved(show(result.values));
                onCommit(result.values);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={cn(inputCls, "min-w-0")}
          />
          {suffix && <span className="shrink-0 text-sm text-sub">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

/** A date field; clearing it saves "" (the page then uses its default). Backdating is allowed. */
export function DateField({
  label,
  hint,
  value,
  onCommit,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onCommit: (value: string) => void;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(props) => (
        <Input
          {...props}
          type="date"
          value={value}
          onChange={(e) => onCommit(e.target.value)}
          className={inputCls}
        />
      )}
    </Field>
  );
}

/** The typed velocities, checked like the number fields: only a valid list is saved. */
export function VelocityField({
  value,
  hint,
  onChange,
  onCommit,
}: {
  value: string;
  hint: ReactNode;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft, markSaved] = useDraft(value);
  const [error, setError] = useState<string | null>(null);
  const check = (raw: string) => {
    const result = validateVelocities(raw);
    setError(result.ok ? null : (result.errors.velocities ?? null));
    return result.ok;
  };

  return (
    <Field label="Points completed per sprint, oldest first" hint={hint} error={error ?? undefined}>
      {(props) => (
        <textarea
          {...props}
          value={draft}
          rows={3}
          placeholder="e.g. 18, 22, 19, 25"
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (check(raw)) {
              markSaved(raw);
              onChange(raw);
            }
          }}
          onBlur={() => {
            if (check(draft)) {
              markSaved(draft);
              onCommit(draft);
            }
          }}
          className="w-full resize-none rounded-md border border-border bg-surface-deep px-3 py-2 font-data text-sm text-text focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20"
        />
      )}
    </Field>
  );
}
