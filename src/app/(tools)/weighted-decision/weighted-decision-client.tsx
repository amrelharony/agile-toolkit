"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import dynamic from "next/dynamic";
import { PercentCircle, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WeightedCriterion, WeightedOption, Workspace } from "@/lib/stores/workspace-types";
import { weightedScore } from "@/lib/analytics/scoring-rubric";
import { generateWeightedPrompts } from "@/lib/ai-prompts/weighted-decision";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WEIGHTED_DECISION_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const WeightedScoreChart = dynamic(() => import("./charts").then((m) => m.WeightedScoreChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** The score scale every cell uses. An empty cell is "not scored". */
const SCORE_MIN = 1;
const SCORE_MAX = 10;

/** Each criterion's share of the total weight, as a whole percent. */
function weightShare(weight: number, weightSum: number): number {
  return weightSum > 0 && Number.isFinite(weight) ? Math.round((weight / weightSum) * 100) : 0;
}

export function WeightedDecisionClient() {
  const criteria = useWorkspaceStore((s) => s.weightedCriteria ?? []);
  const options = useWorkspaceStore((s) => s.weightedOptions ?? []);
  const upsertCriterion = useWorkspaceStore((s) => s.upsertWeightedCriterion);
  const removeCriterion = useWorkspaceStore((s) => s.removeWeightedCriterion);
  const upsertOption = useWorkspaceStore((s) => s.upsertWeightedOption);
  const removeOption = useWorkspaceStore((s) => s.removeWeightedOption);
  const { log } = useHistoryLogger("weighted-decision");
  const exportRef = useRef<HTMLDivElement>(null);

  const [criterionName, setCriterionName] = useState("");
  const [criterionWeight, setCriterionWeight] = useState("1");
  const [optionName, setOptionName] = useState("");

  function addCriterion() {
    if (!criterionName.trim()) return;
    // `parseFloat("0") || 1` collapses an explicit 0 (a temporarily-disabled
    // criterion held in the matrix) to weight 1 — the operator would then
    // appear to "ignore" the weight box. Coerce with Number.isFinite so
    // intentional zeros survive. We still floor at 0 to keep the bar chart
    // and total honest.
    const wRaw = parseFloat(criterionWeight);
    const weight = Number.isFinite(wRaw) ? Math.max(0, wRaw) : 1;
    const c: WeightedCriterion = { id: crypto.randomUUID(), name: criterionName.trim(), weight };
    upsertCriterion(c);
    log(WEIGHTED_DECISION_ACTIONS.CRITERION_ADDED, { name: c.name });
    setCriterionName("");
    setCriterionWeight("1");
  }

  function removeCriterionCascade(criterionId: string) {
    // Cascade: drop the criterion's score from every option so re-adding a
    // criterion with the same name doesn't resurrect stale scores.
    removeCriterion(criterionId);
    for (const o of options) {
      if (criterionId in o.scores) {
        const next = { ...o.scores };
        delete next[criterionId];
        upsertOption({ ...o, scores: next });
      }
    }
    log(WEIGHTED_DECISION_ACTIONS.CRITERION_REMOVED, { id: criterionId });
  }

  function addOption() {
    if (!optionName.trim()) return;
    const o: WeightedOption = { id: crypto.randomUUID(), name: optionName.trim(), scores: {} };
    upsertOption(o);
    log(WEIGHTED_DECISION_ACTIONS.OPTION_ADDED, { name: o.name });
    setOptionName("");
  }

  /** Save a score, or clear it (`null`) so the cell reads "not scored". */
  function setScore(o: WeightedOption, criterionId: string, n: number | null) {
    const scores = { ...o.scores };
    if (n === null) delete scores[criterionId];
    else scores[criterionId] = n;
    upsertOption({ ...o, scores });
    log(WEIGHTED_DECISION_ACTIONS.SCORE_CHANGED, { optionId: o.id, criterionId, n });
    emitSignal({
      kind: "decision.weightedScored",
      at: new Date().toISOString(),
      toolId: "weighted-decision",
      payload: { optionId: o.id, criterionId },
    });
  }

  // A score outside 1–10 isn't saved; this says so next to the matrix.
  const scoreErrorId = useId();
  const [scoreError, setScoreError] = useState<{
    optionId: string;
    criterionId: string;
    text: string;
  } | null>(null);

  function onScoreInput(
    o: WeightedOption,
    c: WeightedCriterion,
    input: Pick<HTMLInputElement, "value" | "validity">
  ) {
    const raw = input.value.trim();
    if (raw === "") {
      // A number input reports "" for half-typed junk ("-", "e") as well as
      // for a cleared cell; only a real clear removes the score.
      if (input.validity?.badInput) return;
      setScoreError(null);
      setScore(o, c.id, null);
      return;
    }
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < SCORE_MIN || n > SCORE_MAX) {
      setScoreError({
        optionId: o.id,
        criterionId: c.id,
        text: `Scores run from ${SCORE_MIN} to ${SCORE_MAX}. ${raw} for ${c.name} on ${o.name} wasn't saved.`,
      });
      return;
    }
    setScoreError(null);
    setScore(o, c.id, n);
  }

  const weights = useMemo(
    () => Object.fromEntries(criteria.map((c) => [c.id, c.weight])),
    [criteria]
  );
  // Weights are relative: 2 counts twice as much as 1, whatever they add up
  // to, and the ranking is the same either way. Each criterion shows its
  // share of the total weight. The old "should sum to 1 or 100" warning
  // fired as soon as a second criterion was added with the default weight
  // of 1; the only sum worth a warning is 0, where every Total is 0.
  const weightSum = useMemo(
    () => criteria.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0),
    [criteria]
  );
  const unscoredCount = (o: WeightedOption) =>
    criteria.filter((c) => !Number.isFinite(o.scores[c.id])).length;

  const ranked = useMemo(() => {
    return [...options]
      .map((o) => ({ ...o, score: weightedScore(o.scores, weights) }))
      .sort((a, b) => b.score - a.score);
  }, [options, weights]);

  // R11-fix: prefix each label with the rank index (1., 2., …) so
  // Recharts treats the Y-axis categories as distinct even when the
  // first 18 chars match. Previously two options like "Vendor
  // Solution Alpha" and "Vendor Solution Beta" both truncated to
  // "Vendor Solution Al…" / "Vendor Solution Be…" — actually distinct
  // here, but on an option named the same followed by a discriminator
  // beyond char-18 (e.g. "Migration plan — A", "Migration plan — B"),
  // Recharts silently merged the duplicate Y-categories and dropped a
  // bar. Same fix pattern as WSJF.
  // Truncate the option name BEFORE prepending the rank so the rank
  // prefix isn't squeezed out of the 150px YAxis tick. Budget ~18 chars
  // total after the rank prefix.
  const chartData = ranked.map((o, idx) => ({
    name: `${idx + 1}. ${o.name.length > 14 ? o.name.slice(0, 14) + "…" : o.name}`,
    score: Number(o.score.toFixed(2)),
  }));

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
        weightedCriteria: s.weightedCriteria,
        weightedOptions: s.weightedOptions,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Weighted Decision Matrix",
      prompts: generateWeightedPrompts({ criteria, ranked }, workspace),
    }),
    [criteria, ranked, workspace]
  );

  const csvData = {
    headers: ["Option", ...criteria.map((c) => `${c.name} (w${c.weight})`), "Total"],
    rows: ranked.map((o) => [
      o.name,
      // An unscored cell exports empty, not as a 0 score.
      ...criteria.map((c) => o.scores[c.id] ?? ""),
      o.score.toFixed(2),
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="weighted-decision"
      title="Weighted Decision Matrix (Pugh / MCDA)"
      description="Score each option against weighted criteria. Total = sum(score × weight). Best for choosing between similar competitors."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Criteria">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Criterion name"
              aria-label="Criterion name"
              value={criterionName}
              onChange={(e) => setCriterionName(e.target.value)}
            />
            <Input
              type="number"
              step="0.5"
              placeholder="Weight"
              aria-label="Criterion weight"
              value={criterionWeight}
              onChange={(e) => setCriterionWeight(e.target.value)}
            />
            <Button onClick={addCriterion} className="gap-1">
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add criterion
            </Button>
          </div>
          {criteria.length > 0 && (
            <p className="mt-2 text-xs text-sub">
              Weights are relative: a weight of 2 counts twice as much as a weight of 1. Each
              criterion shows its share of the total weight.
            </p>
          )}
          {criteria.length > 0 && weightSum <= 0 && (
            <div
              role="alert"
              className="mt-2 rounded border border-warning/30 bg-warning/5 px-2 py-1 text-xs text-warning"
            >
              Every weight is 0, so every option totals 0. Give at least one criterion a weight
              above 0.
            </div>
          )}
          <ul className="mt-2 flex flex-wrap gap-2">
            {criteria.map((c) => (
              <li
                key={c.id}
                className="text-xs bg-surface-deep border border-border rounded px-2 py-1 flex items-center gap-1"
              >
                {c.name}{" "}
                <span className="text-sub">
                  w{c.weight} · {weightShare(c.weight, weightSum)}%
                </span>
                <button
                  type="button"
                  onClick={() => removeCriterionCascade(c.id)}
                  className="min-touch-coarse -m-1 p-1 text-sub hover:text-danger ml-1"
                  aria-label={`Remove criterion ${c.name}`}
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Options">
          <div className="flex gap-2">
            <Input
              placeholder="Option name"
              aria-label="Option name"
              value={optionName}
              onChange={(e) => setOptionName(e.target.value)}
            />
            <Button onClick={addOption} className="gap-1">
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add option
            </Button>
          </div>
        </SectionCard>

        {options.length > 0 && criteria.length > 0 && (
          <SectionCard
            title="Scoring matrix"
            icon={PercentCircle}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="weighted-decision"
                  csvData={csvData}
                  jsonData={{ criteria, options: ranked }}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <p className="mb-2 text-xs text-sub">
              Score each option from {SCORE_MIN} (poor) to {SCORE_MAX} (excellent) on every
              criterion. Leave a cell empty if it isn&apos;t scored yet; it adds nothing to the
              Total.
            </p>
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">Option</th>
                    {criteria.map((c) => (
                      <th key={c.id} className="p-2 text-center">
                        {c.name} <span className="text-sub">×{c.weight}</span>
                      </th>
                    ))}
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2 w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((o, i) => (
                    <tr
                      key={o.id}
                      className={`border-t border-border ${i === 0 ? "bg-success/5" : ""}`}
                    >
                      <td className="p-2">
                        {o.name}
                        {i === 0 && (
                          <span className="ml-1 text-success text-xs">
                            <span aria-hidden="true">★</span>
                            <span className="sr-only">(top option)</span>
                          </span>
                        )}
                      </td>
                      {criteria.map((c) => {
                        const rejected =
                          scoreError?.optionId === o.id && scoreError.criterionId === c.id;
                        return (
                          <td key={c.id} className="p-1 text-center">
                            <Input
                              type="number"
                              min={SCORE_MIN}
                              max={SCORE_MAX}
                              value={o.scores[c.id] ?? ""}
                              // Clearing a cell used to save 0; now it removes
                              // the score ("not scored"), and a value outside
                              // 1–10 is refused with a message below.
                              onChange={(e) => onScoreInput(o, c, e.target)}
                              className="h-7 w-16 text-center text-xs"
                              aria-label={`${c.name} score for ${o.name}`}
                              aria-describedby={rejected ? scoreErrorId : undefined}
                            />
                          </td>
                        );
                      })}
                      <td className="p-2 text-right font-mono">
                        {o.score.toFixed(2)}
                        {unscoredCount(o) > 0 && (
                          <span className="block font-sans text-xs text-sub">
                            {unscoredCount(o)} not scored
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => {
                            removeOption(o.id);
                            log(WEIGHTED_DECISION_ACTIONS.OPTION_REMOVED, { id: o.id });
                          }}
                          className="min-touch-coarse -m-1 p-1 text-sub hover:text-danger"
                          aria-label={`Remove option ${o.name}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scoreError && (
              <p id={scoreErrorId} role="alert" className="mt-2 text-xs text-danger">
                {scoreError.text}
              </p>
            )}
          </SectionCard>
        )}

        {chartData.length > 0 && (
          <SectionCard title="Total score">
            <div className="-mx-2 h-72">
              <WeightedScoreChart data={chartData} />
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
