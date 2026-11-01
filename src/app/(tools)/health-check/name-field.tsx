"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A name edited in place (a custom dimension's, a round's): checked when
 * the field is left or Enter is pressed, and kept as typed, with the
 * reason inline, until it is valid, so a cleared or clashing name is never
 * dropped without a word while the stored one stays. `onRename` saves a
 * good name and returns null, or returns why it can't. Shared by the
 * Health Check and Psych Safety pages.
 */
export function NameField({
  name,
  label,
  maxLength,
  onRename,
  className,
}: {
  name: string;
  /** The accessible name, saying whose name it is ("Name of the round Spring check-in"). */
  label: string;
  maxLength: number;
  onRename: (next: string) => string | null;
  className?: string;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(name);
    setError(null);
  }, [name]);
  const commit = () => {
    if (draft.trim() === name) {
      setDraft(name);
      setError(null);
      return;
    }
    setError(onRename(draft));
  };
  return (
    <Field label={label} hideLabel error={error ?? undefined}>
      {(props) => (
        <Input
          {...props}
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className={cn("h-8 max-w-xs text-sm font-medium", className)}
        />
      )}
    </Field>
  );
}
