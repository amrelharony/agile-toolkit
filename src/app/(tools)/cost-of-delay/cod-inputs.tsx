"use client";

import { MethodInputs } from "@/components/prioritization/method-inputs";
import type { MethodInputsSlotProps } from "@/components/prioritization/method-tool";
import { cn } from "@/lib/utils";
import { formatNumber, toChoice, toNumber } from "@/lib/prioritization/methods/fields";
import {
  COD_URGENCIES,
  COD_URGENCY_MEANING,
  cd3,
} from "@/lib/prioritization/methods/cost-of-delay";
import type { RankedRow } from "@/lib/prioritization/rank";
import { todayIso } from "@/lib/sprints/series";
import { fixedDateStart, startText } from "./lanes";

/** Shorter labels than the registry's, since the unit follows in brackets. */
const LABELS = { perWeekUsd: "Cost of delay", durationWeeks: "Duration" } as const;

/**
 * Cost of Delay's inputs in the method-tool shell: the cost of a week's
 * wait and the weeks of work side by side (the CD3 they make spelled out
 * under them), the urgency profile with what the picked one means, and,
 * only for a fixed date, the day it must land by (it can be any day,
 * past ones included, so a missed date still reads as late).
 */
export function CodInputs({ method, draft, update, errors, custom, size }: MethodInputsSlotProps) {
  const perWeek = toNumber(draft.perWeekUsd);
  const duration = toNumber(draft.durationWeeks);
  const urgency = toChoice(COD_URGENCIES, draft.urgency);
  const preview =
    perWeek !== undefined && perWeek >= 0 && duration !== undefined && duration > 0
      ? formatNumber(cd3(perWeek, duration), 2)
      : null;
  const common = { method, draft, update, errors, custom, size, labels: LABELS };
  return (
    <div className="space-y-4">
      <div>
        <MethodInputs
          {...common}
          only={["perWeekUsd", "durationWeeks"]}
          className="sm:grid-cols-2"
        />
        <p className="mt-1 min-h-4 text-xs text-sub" aria-live="polite">
          {preview !== null
            ? `CD3 = ${preview}: the cost of each week of waiting, per week of work.`
            : ""}
        </p>
      </div>
      <div>
        <MethodInputs {...common} only={["urgency"]} />
        {urgency && <p className="mt-1 text-xs text-text">{COD_URGENCY_MEANING[urgency]}</p>}
      </div>
      {/* Needed only for a fixed date (the registry's validate asks for it then). */}
      {urgency === "fixed_date" && (
        <MethodInputs {...common} only={["fixedDate"]} className="sm:max-w-xs" />
      )}
    </div>
  );
}

/**
 * A row's inputs as "$12,000/wk · 3 wks", a fixed date's start ("Start by
 * 3 Nov to land by 1 Dec", in the danger colour once it's late), and for a
 * row from before CD3 its old total and what it needs.
 */
export function CodRowValues({ ranked }: { ranked: RankedRow }) {
  const today = todayIso();
  const perWeek = toNumber(ranked.values.perWeekUsd);
  const duration = toNumber(ranked.values.durationWeeks);
  const start = fixedDateStart(ranked, today);
  const legacy = toNumber(ranked.result.extra?.totalCost);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-mono text-sub">
        <span className="text-text">
          {perWeek === undefined ? "—" : `$${formatNumber(perWeek, 2)}`}
        </span>
        /wk ·{" "}
        <span className="text-text">
          {duration === undefined ? "—" : formatNumber(duration, 2)}
        </span>{" "}
        {duration === 1 ? "wk" : "wks"}
      </span>
      {start && (
        <span className={cn(start.late ? "text-danger" : "text-sub")}>
          {startText(start, today)}
        </span>
      )}
      {ranked.result.score === null && (
        <span className="text-warning">
          Add a duration to score it
          {legacy !== undefined
            ? ` (old total $${formatNumber(legacy, 2)}, per week × weeks delayed)`
            : ""}
          .
        </span>
      )}
    </div>
  );
}
