"use client";

import type { ReactNode } from "react";
import { MethodInputControl } from "@/components/prioritization/method-inputs";
import type { MethodInputsSlotProps } from "@/components/prioritization/method-tool";
import { isOnScale } from "@/components/shared/scale-picker";
import type { ScaleStep } from "@/lib/prioritization/methods";
import { formatNumber, toChoice, toNumber } from "@/lib/prioritization/methods/fields";
import {
  REACH_PERIODS,
  REACH_PERIOD_LABEL,
  RICE_CONFIDENCE_STEPS,
  RICE_IMPACT_STEPS,
  RICE_MOONSHOT_TEXT,
  reachPerQuarter,
} from "@/lib/prioritization/methods/rice";
import type { RankedRow } from "@/lib/prioritization/rank";

/**
 * RICE's inputs in the method-tool shell, laid out from the registry's
 * definitions (lib/prioritization/methods/rice):
 *
 * - Reach with its period beside it, always visible (the form starts on
 *   the period of the last initiative scored), and the per-quarter count
 *   the score uses spelled out when the period isn't a quarter;
 * - Impact on Intercom's 3 / 2 / 1 / 0.5 / 0.25 scale;
 * - Confidence on 100 / 80 / 50, with a "How sure?" rubric of examples and
 *   the moonshot line;
 * - Effort in person-months, at least 0.5 (the registry's inline error).
 */
export function RiceInputs({ method, draft, update, errors, custom, size }: MethodInputsSlotProps) {
  const byKey = new Map(method.inputs.map((i) => [i.key, i]));
  const control = (key: string) => {
    const input = byKey.get(key);
    if (!input) return null;
    return (
      <MethodInputControl
        input={input}
        value={draft[key]}
        custom={custom?.[key]}
        error={errors[key]}
        size={size}
        onChange={(v) => update({ [key]: v })}
      />
    );
  };
  const reach = toNumber(draft.reach);
  const period = toChoice(REACH_PERIODS, draft.reachPeriod);
  const perQuarter =
    reach !== undefined && reach >= 0 && period && period !== "quarter"
      ? reachPerQuarter(reach, period)
      : null;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-2">
        <div className="min-w-0">
          {control("reach")}
          <p className="mt-1 min-h-4 text-xs text-sub" aria-live="polite">
            {perQuarter !== null
              ? `= ${formatNumber(perQuarter, 1)} per quarter, what the score counts.`
              : ""}
          </p>
        </div>
        {control("reachPeriod")}
      </div>
      {control("impact")}
      <div className="min-w-0">
        {control("confidence")}
        <ConfidenceRubric />
      </div>
      {control("effort")}
    </div>
  );
}

/** "How sure?": what earns each confidence step, and the moonshot line. */
function ConfidenceRubric() {
  return (
    <details className="mt-2 text-xs text-sub">
      <summary className="min-touch-coarse inline-flex cursor-pointer items-center rounded underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        How sure? See examples
      </summary>
      <ul className="mt-2 space-y-1.5">
        {RICE_CONFIDENCE_STEPS.map((s) => (
          <li key={s.value}>
            <span className="font-mono text-text">{s.value}%</span> {s.name},{" "}
            {s.meaning?.toLowerCase()}: {s.example}
          </li>
        ))}
        <li>
          {RICE_MOONSHOT_TEXT} Write it up as a hypothesis in the Hypothesis Tracker before you
          build.
        </li>
      </ul>
    </details>
  );
}

/** A scale value as a row shows it ("80%"), tagged "custom" when it isn't a step. */
function ScaleText({
  steps,
  value,
  suffix = "",
}: {
  steps: readonly ScaleStep[];
  value: unknown;
  suffix?: string;
}) {
  const n = toNumber(value);
  if (n === undefined) return <>—</>;
  return (
    <>
      {n}
      {suffix}
      {!isOnScale(steps, n) && <span className="ml-1 font-sans text-sub">custom</span>}
    </>
  );
}

/** A row's inputs as "R 1,000 per month · I 2 · C 80% · E 2 pm", an off-scale one tagged "custom". */
export function RiceRowValues({ ranked }: { ranked: RankedRow }) {
  const v = ranked.values;
  const reach = toNumber(v.reach);
  const period = toChoice(REACH_PERIODS, v.reachPeriod) ?? "quarter";
  const effort = toNumber(v.effort);
  const parts: { key: string; short: string; name: string; value: ReactNode }[] = [
    {
      key: "reach",
      short: "R",
      name: "Reach",
      value: reach === undefined ? "—" : `${formatNumber(reach, 1)} ${REACH_PERIOD_LABEL[period]}`,
    },
    {
      key: "impact",
      short: "I",
      name: "Impact",
      value: <ScaleText steps={RICE_IMPACT_STEPS} value={v.impact} />,
    },
    {
      key: "confidence",
      short: "C",
      name: "Confidence",
      value: <ScaleText steps={RICE_CONFIDENCE_STEPS} value={v.confidence} suffix="%" />,
    },
    {
      key: "effort",
      short: "E",
      name: "Effort",
      value: effort === undefined ? "—" : `${formatNumber(effort, 2)} pm`,
    },
  ];
  return (
    <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-sub">
      {parts.map((p) => (
        <div key={p.key} className="flex gap-1">
          <dt title={p.name}>
            <span aria-hidden="true">{p.short}</span>
            <span className="sr-only">{p.name}</span>
          </dt>
          <dd className="text-text">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}
