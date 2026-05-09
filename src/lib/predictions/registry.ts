import type { Workspace } from "../stores/workspace-types";
import type { HistoryEvent } from "../history/types";

export type Confidence = "low" | "medium" | "high";

export interface PredictedValue<T> {
  value: T;
  confidence: Confidence;
  source: string;       // human-readable: "Holt forecast over 6 sprints"
  ciLow?: T;
  ciHigh?: T;
}

export type PredictResult<T> = PredictedValue<T> | { value: T; confidence: "none"; source?: string };

export interface PredictionContext {
  workspace: Workspace;
  history: HistoryEvent[];
}

export type Predictor<T> = (ctx: PredictionContext) => PredictResult<T>;

interface RegistryKey { toolId: string; field: string }

const predictors = new Map<string, Predictor<unknown>>();

function keyOf(k: RegistryKey): string { return `${k.toolId}:${k.field}`; }

/**
 * Register a predictor for a (toolId, field) pair. Called once at app boot
 * (see `bootstrap.ts`).
 */
export function registerPredictor<T>(toolId: string, field: string, fn: Predictor<T>): void {
  predictors.set(keyOf({ toolId, field }), fn as Predictor<unknown>);
}

export function lookupPredictor(toolId: string, field: string): Predictor<unknown> | undefined {
  return predictors.get(keyOf({ toolId, field }));
}

/** Inspector for the future debug page. */
export function listPredictors(): RegistryKey[] {
  return Array.from(predictors.keys()).map((k) => {
    const [toolId, field] = k.split(":");
    return { toolId, field };
  });
}

/** Test-only. */
export function __resetPredictorRegistry(): void {
  predictors.clear();
}
