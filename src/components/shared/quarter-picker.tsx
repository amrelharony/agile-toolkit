"use client";

import type { ReactNode, Ref } from "react";
import { Field } from "@/components/ui/field";
import { currentQuarter, dashQuarter, quarterIndex, quarterOptions } from "@/lib/roadmap/quarters";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 font-data text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm";

/** How the quarters are written: the roadmap's "2026 Q3" or the DORA Scorecard's "2026-Q3". */
export type QuarterFormat = "space" | "dash";

const written = (index: number, format: QuarterFormat, space: string) =>
  format === "dash" ? dashQuarter(index) : space;

/**
 * A quarter, picked from a list instead of typed: the free text accepted
 * "next spring" and then drew nothing. The current quarter is marked, and a
 * stored quarter outside the usual years stays listed. `value` and the
 * quarter `onChange` gets are in `format`; `marked` tags quarters that
 * already hold something ("2026-Q2 · logged"), and `latest` leaves out the
 * quarters after it (a quarter that hasn't started can't be measured).
 * `yearsBack` reaches further back than the usual two years (history to
 * backdate), and `currentLabel` names the current quarter ("in progress").
 */
export function QuarterPicker({
  label,
  value,
  onChange,
  now = new Date(),
  also = [],
  format = "space",
  marked,
  markLabel = "logged",
  latest,
  yearsBack,
  currentLabel = "this quarter",
  selectRef,
  hint,
  error,
  required,
  className,
}: {
  label: string;
  /** "2026 Q3" (or "2026-Q3" in dash format), or "" when none is picked yet. */
  value: string;
  onChange: (quarter: string) => void;
  now?: Date;
  /** Other quarters to keep in the list (the epics' dates, the logged quarters). */
  also?: readonly string[];
  format?: QuarterFormat;
  /** Quarters (in `format`) to tag with `markLabel`. */
  marked?: ReadonlySet<string>;
  markLabel?: string;
  /** The last quarter offered, in either format; later ones are left out. */
  latest?: string;
  /** Years before this one to offer (default 2). */
  yearsBack?: number;
  /** The note on the current quarter's option. */
  currentLabel?: string;
  selectRef?: Ref<HTMLSelectElement>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const last = latest ? quarterIndex(latest) : 0;
  const thisQuarter = quarterIndex(currentQuarter(now));
  const options = quarterOptions(now, [value, ...also], { yearsBack })
    .map((q) => ({ index: quarterIndex(q), space: q }))
    .filter((o) => last === 0 || o.index <= last)
    .map((o) => ({ index: o.index, value: written(o.index, format, o.space) }));
  // A stored value the list leaves out (after `latest`) still shows as picked.
  if (value && !options.some((o) => o.value === value)) {
    const index = quarterIndex(value);
    if (index !== 0) options.push({ index, value });
  }
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => (
        <select
          {...props}
          ref={selectRef}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {value === "" && (
            <option value="" disabled>
              Pick a quarter
            </option>
          )}
          {options.map((o) => {
            const notes = [
              o.index === thisQuarter ? currentLabel : null,
              marked?.has(o.value) ? markLabel : null,
            ].filter(Boolean);
            return (
              <option key={o.value} value={o.value}>
                {notes.length > 0 ? `${o.value} (${notes.join(", ")})` : o.value}
              </option>
            );
          })}
        </select>
      )}
    </Field>
  );
}
