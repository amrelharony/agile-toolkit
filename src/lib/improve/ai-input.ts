/**
 * What Improve's two AI buttons send, composed from an improvement and cut
 * to each task's caps here, so the schema never refuses it: a Kata's next
 * experiment (improve.next_experiment) and an A3's countermeasure ideas,
 * which reuse Root Cause's root-cause.countermeasure. No input carries a
 * person's name: owners and the coach stay out.
 */

import type { Improvement, RootCauseAnalysis } from "@/lib/stores/workspace-types";
import { cleanLine, cleanText, paretoRows, whyLines } from "@/lib/root-cause/model";
import {
  EXPERIMENT_INPUT_MAX,
  fitCountermeasureInput,
  type NextExperimentInput,
} from "@/lib/ai/tasks/improve.lite";
import type { CountermeasureInput } from "@/lib/ai/tasks/root-cause.lite";
import { PAST_EXPERIMENTS_MAX, composeCondition, latestReading, workingObstacle } from "./model";

const I = EXPERIMENT_INPUT_MAX;

/** Why a Kata can't ask for its next experiment yet, or null. */
export function experimentBlocker(item: Improvement): string | null {
  if (!workingObstacle(item)) return "Pick the obstacle you're on first.";
  if (!composeCondition(item.target).trim()) return "Set the target first.";
  return null;
}

/**
 * A Kata's next-experiment input: the challenge, the target and where it
 * stands (at the latest reading) in one line each, the metric, the
 * obstacle worked on, and the last 10 experiments. Null while
 * experimentBlocker says why not.
 */
export function experimentInput(item: Improvement): NextExperimentInput | null {
  if (experimentBlocker(item)) return null;
  const obstacle = workingObstacle(item);
  const latest = latestReading(item);
  const now = latest ? { ...item.current, value: latest.value, date: latest.date } : item.current;
  return {
    challenge: cleanText(item.background, I.challenge),
    target: cleanText(composeCondition(item.target, "by"), I.target),
    current: cleanText(composeCondition(now, "on"), I.current),
    metric: cleanLine(item.target.metric ?? item.current.metric ?? "", I.metric),
    obstacle: cleanText(obstacle?.text ?? "", I.obstacle),
    past: item.steps
      .filter((s) => s.status !== "dropped")
      .slice(-PAST_EXPERIMENTS_MAX)
      .map((s) => ({
        step: cleanText(s.text, I.pastField),
        expect: cleanText(s.expect ?? "", I.pastField),
        result: cleanText(s.result ?? "", I.pastField),
        learned: cleanText(s.learned ?? "", I.pastField),
      }))
      .filter((p) => p.step),
  };
}

/** The root cause an A3 works from: its own words, else the linked analysis's. */
export function a3RootCause(item: Improvement, analysis?: RootCauseAnalysis | null): string {
  return cleanText(item.analysis ?? "", 1000) || cleanText(analysis?.rootCause ?? "", 1000);
}

/**
 * An A3's countermeasure input for Root Cause's task: the problem (its
 * title, why it matters and where it stands), the root cause, and the
 * linked analysis's whys and top Pareto causes, fitted to the body budget.
 * Null until there is a root cause ("Write why it happens first.").
 */
export function a3CountermeasureInput(
  item: Improvement,
  analysis?: RootCauseAnalysis | null
): CountermeasureInput | null {
  const rootCause = a3RootCause(item, analysis);
  if (!rootCause) return null;
  const title = item.title.trim().replace(/[.?!]+$/, "");
  const problem = cleanText(
    [`${title}.`, item.background.trim(), composeCondition(item.current, "on")]
      .filter(Boolean)
      .join(" "),
    1000
  );
  return fitCountermeasureInput({
    problem,
    rootCause,
    whys: analysis
      ? whyLines(analysis.whys)
          .slice(0, 20)
          .map((w) => cleanText(w, 1000))
      : [],
    causes: analysis
      ? paretoRows(analysis.causes)
          .slice(0, 20)
          .map((r) => cleanText(r.text, 300))
      : [],
  });
}
