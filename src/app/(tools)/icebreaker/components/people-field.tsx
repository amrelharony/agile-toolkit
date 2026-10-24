"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/charts/chart-text";
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from "../sizes";

/**
 * How many people take part. It starts at the team roster's size, shown
 * as such ("7 people, from your team"), so the filter is never a silent
 * guess; Change types another number for this visit, and blank means any
 * size. A number the filter can't use shows its error instead of being
 * dropped.
 */
export function PeopleField({
  fromRoster,
  text,
  error,
  onTextChange,
  onUseRoster,
}: {
  /** The roster's headcount, or null for no usable roster. */
  fromRoster: number | null;
  /** What's typed; null while following the roster. */
  text: string | null;
  error?: string;
  onTextChange: (text: string) => void;
  onUseRoster: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = text !== null || fromRoster === null;
  const wasEditing = useRef(editing);

  // Change opens the field with the team's number in it, ready to retype.
  useEffect(() => {
    if (editing && !wasEditing.current && fromRoster !== null) inputRef.current?.select();
    wasEditing.current = editing;
  }, [editing, fromRoster]);

  if (!editing) {
    return (
      <div className="space-y-2" role="group" aria-labelledby="icebreaker-filter-people">
        <span
          id="icebreaker-filter-people"
          className="text-xs font-semibold text-sub uppercase tracking-wider flex items-center gap-1.5"
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" /> People
        </span>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text">
          {plural(fromRoster ?? 0, "person", "people")}, from your team
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onTextChange(String(fromRoster))}
          >
            Change
          </Button>
        </p>
      </div>
    );
  }

  return (
    <Field
      label={
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" aria-hidden="true" /> People
        </span>
      }
      hint={`A whole number from ${MIN_HEADCOUNT} to ${MAX_HEADCOUNT}. Leave it blank for any size.`}
      error={touched ? error : undefined}
      className="max-w-sm"
    >
      {(props) => (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            {...props}
            ref={inputRef}
            inputMode="numeric"
            autoComplete="off"
            className="w-28"
            value={text ?? ""}
            placeholder="Any size"
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setTouched(true);
            }}
          />
          {fromRoster !== null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTouched(false);
                onUseRoster();
              }}
            >
              Use team size ({fromRoster})
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}
