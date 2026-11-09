"use client";

import { useId } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WEEKDAY_LABEL, isTime, type CeremonyCadence } from "@/lib/sprints/cadence";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Monday first, as teams read a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * The ceremony times: when the Daily Scrum, Review and Retro run, which
 * weekdays have a daily, and the weekly refinement slot. Every change saves
 * straight away.
 */
export function CadenceForm({
  cadence,
  onChange,
}: {
  cadence: CeremonyCadence;
  onChange: (patch: Partial<CeremonyCadence>) => void;
}) {
  const weekdaysId = useId();
  const time = (key: "dailyTime" | "planningTime" | "reviewTime" | "retroTime") => ({
    type: "time" as const,
    value: cadence[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isTime(e.target.value)) onChange({ [key]: e.target.value });
    },
  });
  const toggleWeekday = (day: number, on: boolean) => {
    const next = on
      ? Array.from(new Set([...cadence.dailyWeekdays, day])).sort((a, b) => a - b)
      : cadence.dailyWeekdays.filter((d) => d !== day);
    if (next.length > 0) onChange({ dailyWeekdays: next });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Daily Scrum" hint="Local time">
        {(control) => <Input {...control} {...time("dailyTime")} />}
      </Field>
      <Field label="Sprint Planning" hint="First day of the sprint">
        {(control) => <Input {...control} {...time("planningTime")} />}
      </Field>
      <Field label="Sprint Review" hint="Last day of the sprint">
        {(control) => <Input {...control} {...time("reviewTime")} />}
      </Field>
      <Field label="Retrospective" hint="Last day, after the review">
        {(control) => <Input {...control} {...time("retroTime")} />}
      </Field>
      <fieldset className="sm:col-span-2">
        <legend id={weekdaysId} className="text-sm font-medium text-text">
          Daily Scrum on
        </legend>
        {/* On touch each day's label (box and name) is a 44px target; the
            rows close up so the list grows only by the taller labels. */}
        <div
          className="mt-2 flex flex-wrap gap-3 pointer-coarse:mt-0 pointer-coarse:gap-y-0"
          role="group"
          aria-labelledby={weekdaysId}
        >
          {WEEK_ORDER.map((day) => (
            <label
              key={day}
              className="inline-flex items-center gap-1.5 text-sm text-text pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={cadence.dailyWeekdays.includes(day)}
                onChange={(e) => toggleWeekday(day, e.target.checked)}
              />
              {WEEKDAY_LABEL[day]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Refinement day" hint="Weekly, during the sprint">
        {(control) => (
          <select
            {...control}
            className={SELECT_CLASS}
            value={cadence.refinement ? String(cadence.refinement.weekday) : "none"}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                refinement:
                  v === "none"
                    ? null
                    : { weekday: Number(v), time: cadence.refinement?.time ?? "11:00" },
              });
            }}
          >
            <option value="none">No fixed day</option>
            {WEEK_ORDER.map((day) => (
              <option key={day} value={String(day)}>
                {WEEKDAY_LABEL[day]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Refinement time">
        {(control) => (
          <Input
            {...control}
            type="time"
            value={cadence.refinement?.time ?? ""}
            disabled={!cadence.refinement}
            onChange={(e) => {
              if (cadence.refinement && isTime(e.target.value)) {
                onChange({ refinement: { ...cadence.refinement, time: e.target.value } });
              }
            }}
          />
        )}
      </Field>
    </div>
  );
}
