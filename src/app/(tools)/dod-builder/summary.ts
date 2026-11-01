/**
 * What the Definition of Done holds, as the Team charter reads it. The DoD
 * is a workspace document now (lib/dod/model); these names stay so the
 * charter's view and older imports keep compiling.
 */

import type { DefinitionOfDone, DodCriterion, DodSnapshot } from "@/lib/stores/workspace-types";
import { DOD_LEGACY_KEY, normalizeDefinitionOfDone } from "@/lib/dod/model";

/** The DoD builder's old blob key, which the one-time move reads. */
export const DOD_STORAGE_KEY = DOD_LEGACY_KEY;

export type DodDocItem = DodCriterion;
export type DodDocSnapshot = DodSnapshot;
export type DodDoc = Pick<DefinitionOfDone, "items" | "history">;

export const EMPTY_DOD: DodDoc = { items: [], history: [] };

/** A stored DoD (the workspace document or the old blob) in a usable shape. */
export function normalizeDod(raw: unknown): DodDoc {
  const { items, history } = normalizeDefinitionOfDone(raw);
  return { items, history };
}
