"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { FieldControlProps } from "@/components/ui/field";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import {
  allZones,
  canonicalZone,
  currentZoneName,
  offsetLabel,
  offsetMinutes,
  zoneLabel,
} from "@/lib/team-time/zones";
import { cn } from "@/lib/utils";

/** Monday first, as calendars print the week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** A native select at the phone size, shrinking only for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm";

/** Weekday checkboxes in a fieldset; `allowed` limits which can be ticked (office days among working days). */
export function DayPicker({
  legend,
  value,
  onChange,
  allowed,
  error,
  hint,
}: {
  legend: string;
  value: readonly number[];
  onChange: (days: number[]) => void;
  allowed?: readonly number[];
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const toggle = (day: number, on: boolean) => {
    const set = new Set(value);
    if (on) set.add(day);
    else set.delete(day);
    onChange(Array.from(set).sort((a, b) => a - b));
  };
  return (
    <fieldset aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}>
      <legend className="text-sm text-text">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {WEEK_ORDER.map((day) => {
          const off = allowed !== undefined && !allowed.includes(day);
          return (
            <label
              key={day}
              className={cn(
                "inline-flex items-center gap-1.5 text-sm text-text pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                off && "text-sub"
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={value.includes(day)}
                disabled={off && !value.includes(day)}
                aria-invalid={error ? true : undefined}
                onChange={(e) => toggle(day, e.target.checked)}
              />
              {WEEKDAY_LABEL[day]}
            </label>
          );
        })}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-sub">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The zones a typed text matches: by city or by name, today's or the
 * runtime's older spelling ("Kolkata" and "Calcutta" both find the zone),
 * the best first, at most `limit`.
 */
export function matchZones(query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (q.length < 2) return [];
  const exact = canonicalZone(query.trim());
  const scored: { zone: string; score: number }[] = [];
  for (const zone of allZones()) {
    const names = Array.from(new Set([zone, currentZoneName(zone)])).map((n) => n.toLowerCase());
    const cities = names.map((n) => n.split("/").pop() ?? n);
    const score =
      zone === exact
        ? 0
        : cities.some((c) => c.startsWith(q))
          ? 1
          : names.some((n) => n.startsWith(q))
            ? 2
            : names.some((n) => n.includes(q))
              ? 3
              : -1;
    if (score >= 0) scored.push({ zone, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone))
    .slice(0, limit)
    .map((s) => s.zone);
}

/**
 * A time-zone field: type a city or a zone name, then pick one of the
 * matches below. The value is the text as typed until a match is picked;
 * the form checks it (an unknown zone is refused, never guessed).
 */
export function ZonePicker({
  control,
  value,
  onChange,
  now,
}: {
  control: FieldControlProps;
  value: string;
  onChange: (zone: string) => void;
  now: Date;
}) {
  const [focused, setFocused] = useState(false);
  const known = canonicalZone(value.trim());
  const matches = useMemo(
    () => (known && known === value.trim() ? [] : matchZones(value)),
    [known, value]
  );
  const listId = `${control.id}-zones`;
  return (
    <div>
      <Input
        {...control}
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder="Type a city, such as Toronto"
        aria-controls={matches.length > 0 ? listId : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
      />
      {known && (
        <p className="mt-1 text-xs text-sub">
          {zoneLabel(known)}, {offsetLabel(offsetMinutes(known, now))} now
        </p>
      )}
      {matches.length > 0 && (focused || !known) && (
        <ul id={listId} aria-label="Matching time zones" className="mt-1 flex flex-wrap gap-1">
          {matches.map((zone) => (
            <li key={zone}>
              <button
                type="button"
                className="min-h-9 rounded-md border border-border bg-card px-2 text-left text-xs text-text hover:bg-accent/10 pointer-coarse:min-h-11"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(zone)}
              >
                {zoneLabel(zone)} <span className="text-sub">({currentZoneName(zone)})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
