/**
 * The EBM Dashboard's AI task, the lite half pages import (no zod; the
 * def, with its schemas, is `ebm-dashboard.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { EBM_VALUE_AREAS, type EbmValueArea } from "@/lib/stores/workspace-types";
import { ideasFor } from "@/lib/ebm/ideas";
import type { EbmMeasuresInput, EbmMeasuresOutput } from "./ebm-dashboard";
export type { EbmMeasuresInput, EbmMeasuresOutput } from "./ebm-dashboard";

/** The input's caps. */
export const MEASURES_PRODUCT_MAX = 600;
export const MEASURES_GOAL_MAX = 1000;
export const MEASURES_EXISTING_MAX = 40;
export const MEASURES_EXISTING_NAME_MAX = 200;
/** The output's caps. */
export const MEASURES_MAX = 5;
export const MEASURE_NAME_MAX = 120;
export const MEASURE_DEFINITION_MAX = 300;
export const MEASURE_UNIT_MAX = 40;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * The answer without AI: the area's own measure ideas (lib/ebm/ideas),
 * leaving out the names the team already has. Throws without a known area.
 */
export function ebmMeasuresFallback(input: EbmMeasuresInput): EbmMeasuresOutput {
  if (!EBM_VALUE_AREAS.includes(input.area as EbmValueArea)) {
    throw new Error("Pick a key value area first.");
  }
  const ideas = ideasFor(input.area, (input.existing ?? []).slice(0, MEASURES_EXISTING_MAX));
  return {
    measures: ideas.slice(0, MEASURES_MAX).map((i) => ({
      name: cut(i.name, MEASURE_NAME_MAX),
      definition: cut(i.definition, MEASURE_DEFINITION_MAX),
      ...(i.unit ? { unit: cut(i.unit, MEASURE_UNIT_MAX) } : {}),
      direction: i.direction,
    })),
  };
}

export const ebmMeasuresTask = lazyAiTask<EbmMeasuresInput, EbmMeasuresOutput>(
  { id: "ebm-dashboard.measures", toolId: "ebm-dashboard", fallback: ebmMeasuresFallback },
  () => import("./ebm-dashboard").then((m) => m.ebmMeasuresTask)
);
