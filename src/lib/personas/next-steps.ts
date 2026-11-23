/**
 * The Persona Library's data-aware next steps (lib/tools/next-steps.ts
 * calls personaSteps through its lazy rule). The example's personas, maps
 * and interviews never count. Pure: no store, no React, no "use client"
 * module.
 *
 *   1. No impact-map actor names a persona yet: use the main one on an
 *      Impact Map.
 *   2. A persona is only a guess while 3 or more interviews are logged:
 *      check it against them.
 *   3. Two or more personas and none is the main one: mark it.
 */

import type { Persona, StrategyMap, UserInterviewLog } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { UI_ID } from "@/lib/interviews/model";
import { isExampleId } from "@/lib/utils/example-id";
import { readPersonas, usedOnMaps } from "./model";

/** What the rule reads from the workspace. */
export interface PersonaStepsInput {
  personas: readonly Persona[] | undefined;
  maps: readonly StrategyMap[] | undefined;
  logs: readonly UserInterviewLog[] | undefined;
}

/** Interviews logged before a persona marked a guess is worth checking against them. */
export const CHECK_AGAINST_INTERVIEWS = 3;

const real = <T extends { id: string }>(rows: readonly T[] | undefined): T[] =>
  (rows ?? []).filter((r) => r && !isExampleId(r.id));

/** The Persona Library's next steps. */
export function personaSteps(s: PersonaStepsInput): NextStep[] {
  const personas = readPersonas(real(s.personas));
  if (personas.length === 0) return [];
  const maps = real(s.maps);
  const interviews = real((s.logs ?? []).find((d) => d.id === UI_ID)?.interviews);
  const steps: NextStep[] = [];

  const lead = personas.find((p) => p.tier === "primary") ?? personas[0];
  if (personas.every((p) => usedOnMaps(p, maps).length === 0)) {
    steps.push({
      id: "persona-use-on-map",
      label: `Use “${lead.name}” on an Impact Map`,
      detail: "No Impact Map names one of your personas as an actor yet.",
      href: "/impact-map",
    });
  }

  const guess = personas.find((p) => p.evidence === "assumed");
  if (guess && interviews.length >= CHECK_AGAINST_INTERVIEWS) {
    steps.push({
      id: "persona-check-guess",
      label: `Check “${guess.name}” against your interviews`,
      detail: `It is marked as your guess, and ${interviews.length} interviews are logged.`,
      href: `/persona-library?persona=${encodeURIComponent(guess.id)}`,
    });
  }

  if (personas.length >= 2 && !personas.some((p) => p.tier === "primary")) {
    steps.push({
      id: "persona-mark-main",
      label: "Mark your main persona",
      detail: `${personas.length} personas and none is the main one: who is the product built for first?`,
      href: "/persona-library",
    });
  }
  return steps;
}
