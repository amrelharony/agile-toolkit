/**
 * Impact Map's AI task, the lite half the page imports (no zod; the def,
 * with its schemas, is `impact-map.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import type { DraftedActor, ImpactDraftInput, ImpactDraftOutput } from "./impact-map";
export type { DraftedActor, ImpactDraftInput, ImpactDraftOutput } from "./impact-map";

/** The input's caps. */
export const IMPACT_DRAFT_TEXT_MAX = 200;
export const IMPACT_DRAFT_CONTEXT_MAX = 2000;
export const IMPACT_DRAFT_PERSONAS_MAX = 12;
export const IMPACT_DRAFT_EXISTING_MAX = 12;
/** The output's caps: at most 5 actors × (1 + 3 impacts × (1 + 3 deliverables)) = 65 parts. */
export const IMPACT_DRAFT_ACTORS_MAX = 5;
export const IMPACT_DRAFT_IMPACTS_MAX = 3;
export const IMPACT_DRAFT_DELIVERABLES_MAX = 3;
export const IMPACT_DRAFT_ACTOR_MAX = 120;

/** Who can move most goals, in our words: the actors a draft without AI starts from. */
export const GENERIC_ACTORS = [
  "People who use it every day",
  "People who decide to buy or adopt it",
  "People who support or sell it",
  "People who could slow it down",
] as const;

/** How many actors the draft without AI offers. */
const FALLBACK_ACTORS = 4;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The goal as a clause: one line, no closing stop, lower-cased at the start. */
function goalClause(goal: string): string {
  const t = goal
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : "the goal";
}

/** "Start doing what “<goal>” needs", with the goal cut so the line fits its cap. */
function startLine(goal: string): string {
  const head = "Start doing what “";
  const tail = "” needs";
  const room = IMPACT_DRAFT_TEXT_MAX - head.length - tail.length;
  return `${head}${cut(goalClause(goal), room)}${tail}`;
}

/**
 * A draft without AI: up to four actors, the library's personas when it
 * has them, else four kinds of people in our words, leaving out any actor
 * the map already has; each with three impacts to rewrite: start doing
 * what the goal needs, do it more often or with less help, and stop doing
 * what gets in the way. No deliverables: "Suggest deliverables" offers
 * those under an impact. Every line fits the output's caps.
 */
export function fallbackImpactMap({ goal, personas, actors }: ImpactDraftInput): ImpactDraftOutput {
  const taken = new Set(actors.map(key));
  const fromPersonas = personas
    .filter((p) => p.name.trim())
    .map((p) => ({ name: cut(p.name.trim(), IMPACT_DRAFT_ACTOR_MAX), persona: p.name.trim() }));
  const generic = GENERIC_ACTORS.map((name) => ({ name, persona: undefined }));
  const fresh = (list: { name: string; persona: string | undefined }[]) =>
    list.filter((a) => !taken.has(key(a.name)));
  let picked = fresh(fromPersonas.length > 0 ? fromPersonas : generic);
  if (picked.length === 0) picked = fresh(generic);
  if (picked.length === 0) picked = generic;
  const impacts = [
    { text: startLine(goal), deliverables: [] },
    { text: "Do it more often, or with less help", deliverables: [] },
    { text: "Stop doing what gets in the way", deliverables: [] },
  ];
  return {
    actors: picked.slice(0, FALLBACK_ACTORS).map(
      (a): DraftedActor => ({
        name: a.name,
        ...(a.persona ? { persona: cut(a.persona, IMPACT_DRAFT_TEXT_MAX) } : {}),
        impacts: impacts.map((i) => ({ ...i, deliverables: [] })),
      })
    ),
  };
}

export const impactMapDraftTask = lazyAiTask<ImpactDraftInput, ImpactDraftOutput>(
  { id: "impact-map.draft", toolId: "impact-map", fallback: fallbackImpactMap },
  () => import("./impact-map").then((m) => m.impactMapDraftTask)
);
