"use client";

import { forwardRef, useState } from "react";
import { Users } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FilterChip } from "./filter-chips";

/**
 * How many people will take part: unset (any size) until typed or taken
 * from the team roster with one click. A number the filter can't use shows
 * its error under the field instead of being dropped.
 */
export const PeopleFilter = forwardRef<
  HTMLInputElement,
  {
    text: string;
    error?: string;
    /** The roster's size, offered as a chip; null for no usable roster. */
    teamSize: number | null;
    onChange: (text: string) => void;
    /**
     * The number is settled: blur, Enter or the team-size chip. The page
     * logs the filter here, not on every keystroke ("1", "12", "120").
     */
    onCommit: (text: string) => void;
  }
>(function PeopleFilter({ text, error, teamSize, onChange, onCommit }, ref) {
  const [touched, setTouched] = useState(false);
  const usingTeam = teamSize !== null && text.trim() === String(teamSize);
  return (
    <Field
      label={
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" aria-hidden="true" /> People
        </span>
      }
      hint="How many will take part. Leave it blank for any size."
      error={touched ? error : undefined}
    >
      {(props) => (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            {...props}
            ref={ref}
            inputMode="numeric"
            autoComplete="off"
            className="w-28"
            placeholder="Any size"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => {
              setTouched(true);
              onCommit(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              setTouched(true);
              onCommit(e.currentTarget.value);
            }}
          />
          {teamSize !== null && (
            <FilterChip
              label={`Use team size (${teamSize})`}
              active={usingTeam}
              onClick={() => {
                const next = usingTeam ? "" : String(teamSize);
                setTouched(false);
                onChange(next);
                onCommit(next);
              }}
            />
          )}
        </div>
      )}
    </Field>
  );
});
